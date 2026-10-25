import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { managerPath, signature, sourceRoot } from "./runtime.ts";
import {
	BackupInfoSchema,
	CreateSchema,
	config,
	controlUrl,
	defaultBackupDirectory,
	defaultBackupIntervalMs,
	HealthSchema,
	InfoSchema,
	type LeaseId,
	LeaseIdSchema,
	LookupSchema,
	message,
	publicUrl,
	RestoreInfoSchema,
	TokenSchema,
	tokenPath,
	UpdateSchema,
} from "./schema.ts";

const logPath = resolve(config.root, "runtime.log");

async function token() {
	await mkdir(config.root, { recursive: true, mode: 0o700 });
	const temporary = `${tokenPath}.${randomUUID()}`;
	await writeFile(temporary, randomBytes(32).toString("hex"), { mode: 0o600 });
	try {
		await link(temporary, tokenPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	} finally {
		await rm(temporary);
	}
	return TokenSchema.parse(await readFile(tokenPath, "utf8"));
}

async function probe(secret: string) {
	const response = await fetch(`${controlUrl}/health`, {
		headers: { authorization: `Bearer ${secret}` },
		signal: AbortSignal.timeout(500),
	}).catch(() => undefined);
	if (!response) return { kind: "missing" } as const;
	if (response.status === 503) {
		await response.text();
		return { kind: "starting" } as const;
	}
	if (!response.ok)
		throw new Error(
			`Flare control port is occupied (${response.status}); refusing to replace its owner`,
		);
	const parsed = HealthSchema.safeParse(await response.json());
	if (!parsed.success)
		throw new Error(
			"Unrecognized Flare manager; refusing to replace its owner",
		);
	const health = parsed.data;
	if (
		health.root !== config.root ||
		health.host !== config.host ||
		health.port !== config.port ||
		health.sourceRoot !== sourceRoot ||
		health.publicUrl !== publicUrl ||
		(health.backupDirectory ?? defaultBackupDirectory) !==
			config.backupDirectory ||
		(health.backupIntervalMs ?? defaultBackupIntervalMs) !==
			config.backupIntervalMs ||
		(health.backupKeep ?? 0) !== config.backupKeep
	)
		throw new Error(
			"Another Flare configuration owns this control port; use matching settings or different ports",
		);
	return { kind: "ready", health } as const;
}

async function lease(method: "PUT" | "DELETE", id: LeaseId, secret: string) {
	const response = await fetch(`${controlUrl}/lease/${id}`, {
		method,
		headers: { authorization: `Bearer ${secret}` },
		signal: AbortSignal.timeout(2000),
	});
	if (!response.ok) throw new Error("Flare lease request failed");
	await response.text();
}

export default function (pi: ExtensionAPI) {
	let connection:
		| { secret: string; close: (release?: boolean) => Promise<void> }
		| undefined;
	const id = LeaseIdSchema.parse(randomUUID());
	let starting: Promise<string> | undefined;
	let closed = false;
	let warn = (_text: string) => {};

	async function connect() {
		const secret = await token();
		const previous = connection;
		connection = undefined;
		await previous?.close(false);
		let spawned = false;
		let restartRequested = false;
		let spawnError: Error | undefined;
		for (let attempt = 0; attempt < 300; attempt++) {
			if (closed) throw new Error("Pi session is shutting down");
			if (spawnError) throw spawnError;
			const current = await probe(secret);
			if (current.kind === "missing" && !spawned) {
				spawned = true;
				const log = await open(logPath, "a", 0o600);
				try {
					const child = spawn("bun", [managerPath], {
						stdio: ["ignore", log.fd, log.fd],
						detached: true,
						env: { ...process.env, PI_FLARE_SIGNATURE: await signature() },
					});
					child.on("error", (error) => {
						spawnError = error;
					});
					child.unref();
				} finally {
					await log.close();
				}
			}
			if (
				current.kind === "ready" &&
				current.health.signature !== (await signature())
			) {
				if (current.health.reloadError)
					throw new Error(
						`Flare update could not compile: ${current.health.reloadError}`,
					);
				if (!restartRequested) {
					restartRequested = true;
					const response = await fetch(`${controlUrl}/restart`, {
						method: "POST",
						headers: { authorization: `Bearer ${secret}` },
						signal: AbortSignal.timeout(2000),
					});
					if (!response.ok) throw new Error(await response.text());
					await response.text();
				}
			} else if (current.kind === "ready") {
				await lease("PUT", id, secret);
				if (closed) {
					await lease("DELETE", id, secret);
					throw new Error("Pi session is shutting down");
				}
				let renewing = Promise.resolve();
				const timer = setInterval(() => {
					if (connection !== current) return;
					renewing = lease("PUT", id, secret).catch(() => {
						// A refresh briefly interrupts connections; retain the lease ID
						// and retry next heartbeat instead of disconnecting the session.
						if (connection === current)
							warn(`Flare reconnecting; inspect ${logPath} if this persists`);
					});
				}, 5000).unref();
				const current = {
					secret,
					close: async (release = true) => {
						clearInterval(timer);
						await renewing;
						if (release) await lease("DELETE", id, secret);
					},
				};
				connection = current;
				return secret;
			}
			await new Promise((done) => setTimeout(done, 100));
		}
		throw new Error(
			`Flare did not become ready; inspect ${logPath} (requires bun, celld, and esbuild on PATH)`,
		);
	}

	async function ensure() {
		if (closed) throw new Error("Pi session is shutting down");
		if (connection) {
			const current = await probe(connection.secret);
			if (
				current.kind === "ready" &&
				current.health.signature === (await signature())
			)
				return connection.secret;
		}
		starting ??= connect().finally(() => {
			starting = undefined;
		});
		return starting;
	}

	async function request<S extends z.ZodType>(
		method: string,
		path: string,
		body: unknown,
		schema: S,
		signal?: AbortSignal,
		timeoutMs = 30_000,
	) {
		signal?.throwIfAborted();
		const secret = await ensure();
		const response = await fetch(`${controlUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${secret}`,
				"content-type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
				: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error(await response.text());
		return schema.parse(await response.json());
	}

	function register<S extends z.ZodType, R extends z.ZodType<JsonValue>>(
		name: string,
		description: string,
		input: S,
		output: R,
		method: string,
		path: (params: z.input<S>) => string,
	) {
		pi.registerTool({
			name: `flare_${name}`,
			label: `Flare ${name}`,
			description,
			namespace: {
				name: "flare",
				description:
					"Filesystem-first microapps. Each app is stored directly under the Flare home and mounted at /<id>/. Browser fetch('/api/...') targets the shared origin root, not the app. Resolve frontend URLs against the returned app URL (or use './api/...' from its homepage). Workers receive paths with the mount prefix removed, e.g. '/api/count'. Browse all apps at /.",
			},
			parameters: Type.Unsafe<z.input<S>>(
				z.toJSONSchema(input, { io: "input" }),
			),
			outputSchema: Type.Unsafe<z.output<R>>(z.toJSONSchema(output)),
			annotations: {
				readOnlyHint: method === "GET",
				destructiveHint: method === "DELETE" || method === "PUT",
				openWorldHint: false,
			},
			async execute(_id, params, signal) {
				const data = await request(
					method,
					path(params),
					method === "POST" || method === "PUT" ? params : undefined,
					output,
					signal,
				);
				const text = JSON.stringify(data, null, 2);
				return {
					content: [
						{
							type: "text",
							text:
								text.length > 12_000
									? `${text.slice(0, 12_000)}\nOutput shortened; use flare_get for one app.`
									: text,
						},
					],
					details: data,
					structuredContent: data,
				};
			},
		});
	}

	register(
		"create",
		"Create an app with an adjective-noun ID. Returns its public and internal URLs, editable directory, and expiresAt. If the public URL is inaccessible (for example, behind auth), try the internal URL on the local Flare bind. Templates: static, worker, or durable (a Worker plus an App facet). Optional ttl_seconds expires and removes source files; omitted or null means forever. The returned URL is the app base: browser fetch('./api/count') from the homepage reaches /<id>/api/count; the Worker matches pathname === '/api/count'. A leading slash is valid only with the full public app prefix. Edit app.json, worker.ts, and public/ directly; changes go live automatically.",
		CreateSchema,
		InfoSchema,
		"POST",
		() => "/apps",
	);
	register(
		"list",
		"List apps, expiry times, source directories, public and internal URLs, build errors, and revisions. If the public URL is inaccessible (for example, behind auth), try the internal URL on the local Flare bind. Starts or attaches to the shared runtime for this Pi session.",
		z.strictObject({}),
		z.array(InfoSchema),
		"GET",
		() => "/apps",
	);
	register(
		"get",
		"Read an app's manifest, expiry time, editable directory, public and internal URLs, and build status. If the public URL is inaccessible (for example, behind auth), try the internal URL on the local Flare bind. Use normal read/edit/write tools for its source files. Frontend requests must stay under the returned app URL: './api/count' from the homepage or '/<id>/api/count'. Workers see '/api/count', not the public mount prefix; use exact pathname checks.",
		LookupSchema,
		InfoSchema,
		"GET",
		({ id }) => `/apps/${id}`,
	);
	register(
		"update",
		"Update app.json title, description, or TTL. ttl_seconds resets expiry from now; null removes expiry; omitted leaves it unchanged. Edit the returned directory directly for app code, worker configuration, and durable classes.",
		UpdateSchema,
		InfoSchema,
		"PUT",
		({ id }) => `/apps/${id}`,
	);
	register(
		"delete",
		"Delete an app's source directory and stop serving its URL. Durable data is retained outside the source tree; recreating the same ID restores that data.",
		LookupSchema,
		z.object({ id: LookupSchema.shape.id, removed: z.literal(true) }),
		"DELETE",
		({ id }) => `/apps/${id}`,
	);

	pi.registerCommand("flare", {
		description:
			"Show apps, create a backup, or restore one: /flare [backup | restore <name-or-path>]",
		handler: async (args, ctx) => {
			try {
				const input = args.trim();
				if (input === "backup") {
					const snapshot = await request(
						"POST",
						"/backup",
						undefined,
						BackupInfoSchema,
						undefined,
						300_000,
					);
					if (ctx.hasUI)
						ctx.ui.notify(
							`Flare backup: ${snapshot.path}\nRestore with /flare restore ${basename(snapshot.path)}`,
							"info",
						);
					return;
				}
				if (input.startsWith("restore ")) {
					if (!ctx.isIdle())
						throw new Error(
							"Wait for the agent to finish before restoring Flare",
						);
					const backup = input.slice("restore ".length).trim();
					if (!backup)
						throw new Error("Usage: /flare restore <backup-name-or-path>");
					if (
						ctx.hasUI &&
						!(await ctx.ui.confirm(
							"Restore Flare backup?",
							`Replace all apps and durable data in ${config.root} with ${backup}? A recovery backup will be saved first. All connected Flare sessions will briefly restart.`,
						))
					)
						return;
					const result = await request(
						"POST",
						"/restore",
						{ backup },
						RestoreInfoSchema,
						undefined,
						300_000,
					);
					if (ctx.hasUI)
						ctx.ui.notify(
							`Restored ${result.restored.path}; Flare is restarting.\nRecovery backup: ${result.recovery.path}`,
							"info",
						);
					return;
				}
				if (input)
					throw new Error(
						"Usage: /flare [backup | restore <backup-name-or-path>]",
					);
				const apps = await request(
					"GET",
					"/apps",
					undefined,
					z.array(InfoSchema),
				);
				if (ctx.hasUI)
					ctx.ui.notify(
						apps.length
							? apps
									.map(
										(app) => `${app.id}: ${app.url} (${app.deployment.status})`,
									)
									.join("\n")
							: "Flare is running; use flare_create to create an app",
						"info",
					);
			} catch (error) {
				if (ctx.hasUI) ctx.ui.notify(message(error), "error");
			}
		},
	});
	pi.on("session_start", (_event, ctx) => {
		closed = false;
		warn = (text) => {
			if (ctx.hasUI) ctx.ui.notify(text, "warning");
		};
	});
	pi.on("session_shutdown", async () => {
		closed = true;
		const current = connection;
		connection = undefined;
		await current?.close().catch(() => {});
	});
}
