import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { faker } from "@faker-js/faker";
import { serve } from "@hono/node-server";
import { type FSWatcher, watch } from "chokidar";
import { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import { z } from "zod";
import { Backups, createBackup } from "./backup.ts";
import { renderApps } from "./page.ts";
import { readBackup, restoreBackup } from "./restore.ts";
import { indexPath, managerPath, signature, sourceRoot } from "./runtime.ts";
import {
	type AppId,
	type AppInfo,
	CreateSchema,
	config,
	controlUrl,
	esbuild,
	IdSchema,
	type LeaseId,
	LeaseIdSchema,
	LeaseSnapshotSchema,
	LifetimeSchema,
	localUrl,
	ManifestSchema,
	message,
	type Published,
	publicUrl,
	RestoreSchema,
	SignatureSchema,
	service,
	TokenSchema,
	tokenPath,
	UpdateSchema,
} from "./schema.ts";
import { appIds, hasAppManifest, migrateApps } from "./storage.ts";

const run = promisify(execFile);
const token = TokenSchema.parse(await readFile(tokenPath, "utf8"));
const project = resolve(config.root, "runtime");
const loadedSignature = SignatureSchema.parse(
	process.env.PI_FLARE_SIGNATURE ?? (await signature()),
);
const handoffPath = resolve(config.root, "leases.json");
let candidate = loadedSignature;
let rejected: typeof loadedSignature | undefined;
let reloading = false;
let restoring = false;
let reloadError: string | undefined;
let checking = false;
type Deployment =
	| { status: "ready"; app: Published }
	| { status: "error"; error: string; lastGood?: Published };
const deployments = new Map<AppId, Deployment>();
const pending = new Map<AppId, Promise<void>>();
const debounce = new Map<AppId, ReturnType<typeof setTimeout>>();
let mutations = Promise.resolve();
let cleaning: Promise<void> | undefined;
let child: ChildProcess | undefined;
let watcher: FSWatcher | undefined;
let ready = false;
let stopping = false;
let finishing = false;
let shutdownRequested = false;
const backups = new Backups(config, mutate);
let backupCheck: Promise<void> | undefined;
const leases = new Map<LeaseId, number>();

function mutate<T>(action: () => Promise<T>): Promise<T> {
	const result = mutations.then(action);
	mutations = result.then(
		() => {},
		() => {},
	);
	return result;
}

function backup() {
	if (backupCheck) return;
	backupCheck = backups
		.check()
		.catch((error) => console.error(`Flare backup: ${message(error)}`))
		.finally(() => {
			backupCheck = undefined;
		});
}

async function directory(id: AppId) {
	const path = resolve(config.root, id);
	if ((await realpath(path)) !== path)
		throw new Error("App directories cannot be symlinks");
	return path;
}

// Canonicalize once at the filesystem boundary; never serve escaping symlinks.
async function file(base: string, path: string) {
	const canonical = await realpath(resolve(base, path));
	if (!canonical.startsWith(`${base}${sep}`))
		throw new Error("File escapes its source directory");
	return canonical;
}

async function appJson(id: AppId): Promise<unknown> {
	const base = await directory(id);
	return JSON.parse(await readFile(await file(base, "app.json"), "utf8"));
}

async function manifest(id: AppId) {
	return ManifestSchema.parse(await appJson(id));
}

function lastPublished(id: AppId) {
	const deployment = deployments.get(id);
	return deployment?.status === "ready" ? deployment.app : deployment?.lastGood;
}

async function expiration(id: AppId) {
	try {
		return LifetimeSchema.parse(await appJson(id)).expiresAt;
	} catch (error) {
		if (!(error instanceof z.ZodError || error instanceof SyntaxError))
			throw error;
		return lastPublished(id)?.manifest.expiresAt ?? null;
	}
}

const expired = (expiresAt: z.infer<typeof LifetimeSchema>["expiresAt"]) =>
	expiresAt !== null && expiresAt <= Date.now();

async function removeApp(id: AppId) {
	await rm(await directory(id), { recursive: true });
	await pending.get(id);
	deployments.delete(id);
}

function cleanup() {
	cleaning ??= mutate(async () => {
		for (const id of await appIds(config.root)) {
			try {
				if (expired(LifetimeSchema.parse(await appJson(id)).expiresAt))
					await removeApp(id);
			} catch (error) {
				if (
					!(error instanceof z.ZodError || error instanceof SyntaxError) &&
					(error as NodeJS.ErrnoException).code !== "ENOENT"
				)
					console.error(`Flare cleanup ${id}: ${message(error)}`);
			}
		}
	}).finally(() => {
		cleaning = undefined;
	});
	return cleaning;
}

async function atomic(path: string, value: unknown) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
	await rename(temporary, path);
}

function refresh(id: AppId): Promise<void> {
	const next = (pending.get(id) ?? Promise.resolve()).then(async () => {
		const lastGood = lastPublished(id);
		try {
			const app = await manifest(id);
			let published: Published;
			if (app.type === "static")
				published = { manifest: app, revision: "static" };
			else {
				const base = await directory(id);
				const entry = await file(base, app.entry);
				const { stdout } = await run(
					esbuild,
					[
						entry,
						"--bundle",
						"--format=esm",
						"--platform=neutral",
						"--external:cloudflare:*",
						"--log-level=error",
					],
					{
						cwd: base,
						timeout: 15_000,
						maxBuffer: 64 * 1024 * 1024,
					},
				);
				const revision = createHash("sha256")
					.update(JSON.stringify(app))
					.update(stdout)
					.digest("hex");
				published = { manifest: app, revision, source: stdout };
			}
			deployments.set(id, { status: "ready", app: published });
		} catch (error) {
			if (!(await hasAppManifest(resolve(config.root, id))))
				deployments.delete(id);
			else {
				deployments.set(id, {
					status: "error",
					error: message(error),
					lastGood,
				});
				console.error(`Flare build ${id}: ${message(error)}`);
			}
		}
	});
	pending.set(id, next);
	void next.finally(() => {
		if (pending.get(id) === next) pending.delete(id);
	});
	return next;
}

async function scan() {
	const ids = new Set(await appIds(config.root));
	for (const id of ids) if (!deployments.has(id)) await refresh(id);
	for (const id of deployments.keys()) if (!ids.has(id)) deployments.delete(id);
}

async function info(id: AppId): Promise<AppInfo> {
	const deployment = deployments.get(id);
	if (!deployment)
		throw Object.assign(new Error("App not found"), { code: "ENOENT" });
	return {
		id,
		directory: resolve(config.root, id),
		url: `${publicUrl}/${id}/`,
		internalUrl: `${localUrl}/${id}/`,
		expiresAt: await expiration(id),
		deployment:
			deployment.status === "ready"
				? {
						status: "ready" as const,
						manifest: deployment.app.manifest,
						revision: deployment.app.revision,
					}
				: {
						status: "error" as const,
						error: deployment.error,
						servingRevision: deployment.lastGood?.revision,
					},
	};
}

async function listApps() {
	return mutate(async () => {
		await scan();
		const apps = await Promise.all([...deployments.keys()].sort().map(info));
		return apps.filter((app) => !expired(app.expiresAt));
	});
}

const html =
	'<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Flare app</title><h1>Your app is ready</h1><p>Edit public/index.html to make it yours.</p></html>\n';
const worker = `export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === "/api/hello")
      return Response.json({ message: "Hello from Flare" });
    return env.ASSETS.fetch(request);
  }
};
`;
const durable = `import { DurableObject } from "cloudflare:workers";

export class App extends DurableObject {
  fetch(request) {
    if (request.method !== "GET" && request.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    let count = this.ctx.storage.kv.get("count") ?? 0;
    if (request.method === "POST") {
      count += 1;
      this.ctx.storage.kv.put("count", count);
    }
    return Response.json({ count });
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === "/api/count")
      return env.OBJECTS.fetch(new Request("https://objects/App/main/", request));
    return env.ASSETS.fetch(request);
  }
};
`;

function frontend(template: z.output<typeof CreateSchema>["template"]) {
	if (template === "static") return html;
	const isDurable = template === "durable";
	return html.replace(
		"</html>",
		`<p><button id="call-api">${isDurable ? "Add one" : "Call API"}</button> <output id="result" aria-live="polite"></output></p>
<script type="module">
// Browser URLs resolve against this app's homepage, not the shared origin root.
// The Worker sees /api/${isDurable ? "count" : "hello"}, with the /<id> prefix removed.
const result = document.querySelector("#result");
async function callApi(method = "GET") {
  const response = await fetch("./api/${isDurable ? "count" : "hello"}", { method });
  if (!response.ok) throw new Error("API request failed: " + response.status);
  result.textContent = JSON.stringify(await response.json());
}
const showError = (error) => { result.textContent = error.message; };
document.querySelector("#call-api").addEventListener("click", () => {
  callApi("${isDurable ? "POST" : "GET"}").catch(showError);
});
callApi().catch(showError);
</script></html>`,
	);
}

async function refreshRuntime() {
	const next = await signature();
	if (
		shutdownRequested ||
		reloading ||
		restoring ||
		stopping ||
		next === loadedSignature ||
		next === rejected
	)
		return;
	reloading = true;
	const checkDirectory = resolve(project, `.refresh-${randomUUID()}`);
	try {
		// Check syntax before taking down a working runtime. App code is not
		// involved; dependencies remain external and no package scripts run.
		await run(
			esbuild,
			[
				managerPath,
				indexPath,
				resolve(sourceRoot, "gateway.js"),
				"--bundle",
				"--packages=external",
				"--platform=node",
				"--format=esm",
				"--log-level=error",
				`--outdir=${checkDirectory}`,
			],
			{ timeout: 15_000, maxBuffer: 1024 * 1024 },
		);
		if ((await signature()) !== next) {
			reloading = false;
			return;
		}
		ready = false;
		await watcher?.close();
		await mutations;
		await Promise.all(pending.values());
		console.log(`FLARE_REFRESH ${loadedSignature} -> ${next}`);
		stop();
	} catch (error) {
		rejected = next;
		reloadError = message(error);
		reloading = false;
		console.error(
			`Flare update rejected; current runtime remains live: ${reloadError}`,
		);
	} finally {
		await rm(checkDirectory, { recursive: true, force: true });
	}
}

async function checkSource() {
	if (checking || stopping || reloading || !ready) return;
	checking = true;
	try {
		const next = await signature();
		// Two identical observations debounce partial saves/package updates.
		if (next !== loadedSignature && next === candidate) await refreshRuntime();
		else candidate = next;
	} catch (error) {
		console.error(`Flare source check: ${message(error)}`);
	} finally {
		checking = false;
	}
}

const api = new Hono();
api.use("*", async (c, next) => {
	if (c.req.header("authorization") !== `Bearer ${token}`)
		return c.text("Unauthorized", 401);
	return next();
});
api.get("/health", (c) =>
	ready
		? c.json({
				service,
				root: config.root,
				host: config.host,
				port: config.port,
				signature: loadedSignature,
				sourceRoot,
				publicUrl,
				pid: process.pid,
				leases: leases.size,
				backupDirectory: config.backupDirectory,
				backupIntervalMs: config.backupIntervalMs,
				backupKeep: config.backupKeep,
				...(reloadError ? { reloadError } : {}),
			})
		: c.text("Starting", 503),
);
api.post("/restart", (c) => {
	void refreshRuntime().catch((error) => console.error(error));
	return c.json({ refreshing: true }, 202);
});
api.put("/lease/:id", (c) => {
	leases.set(LeaseIdSchema.parse(c.req.param("id")), Date.now() + 15_000);
	return c.text("ok");
});
api.delete("/lease/:id", (c) => {
	leases.delete(LeaseIdSchema.parse(c.req.param("id")));
	return c.text("ok");
});
api.use("*", async (c, next) => {
	if (stopping || shutdownRequested || reloading || restoring)
		return c.text(
			"Flare is stopping, refreshing, or restoring; retry shortly",
			503,
		);
	await next();
});
api.post("/stop", (c) => {
	shutdownRequested = true;
	ready = false;
	// Let the response flush before closing the control listener.
	setTimeout(stop, 100).unref();
	return c.json({ stopping: true }, 202);
});
api.post("/backup", async (c) =>
	c.json(await mutate(() => createBackup(config))),
);
api.post("/restore", async (c) => {
	const input = RestoreSchema.parse(await c.req.json());
	const source = await readBackup(config, input.backup);
	// Recheck after asynchronous validation, before claiming the runtime.
	if (stopping || reloading || restoring)
		return c.text("Flare is refreshing or restoring; retry shortly", 503);
	restoring = true;
	ready = false;
	const result = await mutate(async () => {
		try {
			await watcher?.close();
			for (const timer of debounce.values()) clearTimeout(timer);
			debounce.clear();
			await Promise.all(pending.values());
			await pauseChild();
			return await restoreBackup(config, source);
		} finally {
			// Restart even on failure: a failed restore rolls back the old trees.
			reloading = true;
			// Let the HTTP response flush before relinquishing the control port.
			setTimeout(stop, 100).unref();
		}
	});
	console.log(
		`FLARE_RESTORE ${result.restored.path} (recovery: ${result.recovery.path})`,
	);
	return c.json(result);
});
api.get("/apps", async (c) => c.json(await listApps()));
api.get("/directory", async (c) => {
	c.header("cache-control", "no-store");
	c.header("x-content-type-options", "nosniff");
	return c.html(renderApps(await listApps()));
});
api.get("/apps/:id", async (c) => {
	const id = IdSchema.parse(c.req.param("id"));
	await pending.get(id);
	if (!deployments.has(id)) await refresh(id);
	return c.json(await info(id));
});
api.post("/apps", async (c) => {
	const input = CreateSchema.parse(await c.req.json());
	return c.json(
		await mutate(async () => {
			let id: AppId;
			let base: string;
			for (;;) {
				id = IdSchema.parse(
					[faker.word.adjective(), faker.word.noun()]
						.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
						.join("-"),
				);
				base = resolve(config.root, id);
				try {
					await mkdir(base);
					break;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
			}
			try {
				await mkdir(resolve(base, "public"));
				await writeFile(
					resolve(base, "public/index.html"),
					frontend(input.template),
				);
				if (input.template !== "static")
					await writeFile(
						resolve(base, "worker.ts"),
						input.template === "durable" ? durable : worker,
					);
				await atomic(
					resolve(base, "app.json"),
					ManifestSchema.parse({
						type: input.template === "static" ? "static" : "worker",
						title: input.title,
						description: input.description,
						expiresAt: input.expiresAt,
						...(input.template !== "static"
							? { objects: input.template === "durable" ? ["App"] : [] }
							: {}),
					}),
				);
				await refresh(id);
				return info(id);
			} catch (error) {
				await rm(base, { recursive: true, force: true });
				throw error;
			}
		}),
		201,
	);
});
api.put("/apps/:id", async (c) => {
	const input = UpdateSchema.parse({
		...(await c.req.json()),
		id: c.req.param("id"),
	});
	return c.json(
		await mutate(async () => {
			const current = await manifest(input.id);
			await atomic(resolve(await directory(input.id), "app.json"), {
				...current,
				title: input.title ?? current.title,
				description: input.description ?? current.description,
				expiresAt:
					input.expiresAt === undefined ? current.expiresAt : input.expiresAt,
			});
			await refresh(input.id);
			return info(input.id);
		}),
	);
});
api.delete("/apps/:id", async (c) => {
	const id = IdSchema.parse(c.req.param("id"));
	await mutate(() => removeApp(id));
	return c.json({ id, removed: true });
});
api.get("/bundle/:id", async (c) => {
	const id = IdSchema.parse(c.req.param("id"));
	const deployment = deployments.get(id);
	if (!deployment) return c.text("Not found", 404);
	if (expired(await expiration(id))) return c.text("App expired", 404);
	const app = lastPublished(id);
	return app ? c.json(app) : c.text("Build failed", 503);
});
api.on(["GET", "HEAD"], "/assets/:id/*", async (c) => {
	const id = IdSchema.parse(c.req.param("id"));
	if (expired(await expiration(id))) return c.text("App expired", 404);
	const relative = decodeURIComponent(
		new URL(c.req.url).pathname.split("/").slice(3).join("/"),
	);
	const path = await file(
		resolve(await directory(id), "public"),
		relative.endsWith("/") || !relative ? `${relative}index.html` : relative,
	);
	const content = await readFile(path);
	return new Response(c.req.method === "HEAD" ? null : content, {
		headers: {
			"content-type": getMimeType(path) ?? "application/octet-stream",
			"content-length": String(content.length),
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
});
api.onError((error, c) => {
	const code = (error as NodeJS.ErrnoException).code;
	return c.text(
		message(error),
		error instanceof z.ZodError || error instanceof SyntaxError
			? 400
			: code === "ENOENT"
				? 404
				: 500,
	);
});

async function pauseChild() {
	const current = child;
	if (!current || current.exitCode !== null || current.signalCode !== null)
		return;
	await new Promise<void>((done) => {
		const timer = setTimeout(() => current.kill("SIGKILL"), 10_000).unref();
		current.once("exit", () => {
			clearTimeout(timer);
			done();
		});
		current.kill("SIGTERM");
	});
}

function shutdown() {
	shutdownRequested = true;
	stop();
}

function stop() {
	if (stopping) return;
	stopping = true;
	ready = false;
	void watcher?.close();
	for (const timer of debounce.values()) clearTimeout(timer);
	// Keep the authenticated control listener bound until celld releases its
	// public port and SQLite handles. Other Pi clients must not start early.
	if (!child || child.exitCode !== null || child.signalCode !== null) {
		void finish(0);
		return;
	}
	child.once("exit", () => {
		void finish(0);
	});
	child.kill("SIGTERM");
	setTimeout(() => {
		child?.kill("SIGKILL");
		void finish(1);
	}, 10_000).unref();
}

async function finish(code: number) {
	if (finishing) return;
	finishing = true;
	// Keep the control port bound until an in-flight snapshot is published or
	// cleaned up, so the next manager cannot overlap it during a refresh.
	await backups.wait().catch(() => {});
	await mutations;
	const restart = reloading && !shutdownRequested && code === 0;
	if (restart) {
		const now = Date.now();
		await atomic(
			handoffPath,
			[...leases]
				.filter(([, expiry]) => expiry > now)
				.map(([id]) => [id, now + 30_000]),
		);
	}
	server.close();
	if ("closeAllConnections" in server) server.closeAllConnections();
	if (restart) {
		const replacement = spawn("bun", [managerPath], {
			stdio: ["ignore", "inherit", "inherit"],
			detached: true,
			env: { ...process.env, PI_FLARE_SIGNATURE: await signature() },
		});
		replacement.on("error", (error) => {
			console.error(error);
			process.exit(1);
		});
		replacement.unref();
	}
	process.exit(code);
}

async function start() {
	try {
		const snapshot = LeaseSnapshotSchema.parse(
			JSON.parse(await readFile(handoffPath, "utf8")),
		);
		for (const [id, expiry] of snapshot)
			if (expiry > Date.now())
				leases.set(id, Math.max(expiry, leases.get(id) ?? 0));
		await rm(handoffPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	setInterval(() => {
		for (const [id, expires] of leases) {
			if (expires <= Date.now()) leases.delete(id);
		}
		if (ready && !stopping) {
			void cleanup().catch((error) => console.error(error));
			void checkSource();
			backup();
		}
	}, 1000).unref();
	await mkdir(config.root, { recursive: true });
	const migrated = await migrateApps(config.root);
	if (migrated.length) console.log(`FLARE_MIGRATE ${migrated.join(", ")}`);
	await cleanup();
	await run(esbuild, ["--version"]);
	await mkdir(project, { recursive: true });
	await writeFile(
		resolve(project, "gateway.js"),
		await readFile(resolve(sourceRoot, "gateway.js")),
	);
	await atomic(resolve(project, "wrangler.json"), {
		name: "pi-flare",
		main: "gateway.js",
		compatibility_date: "2026-01-01",
		worker_loaders: [{ binding: "LOADER" }],
		durable_objects: {
			bindings: [{ name: "SUPERVISOR", class_name: "Supervisor" }],
		},
		migrations: [{ tag: "v1", new_sqlite_classes: ["Supervisor"] }],
		vars: { REGISTRY: controlUrl, TOKEN: token },
	});
	watcher = watch(config.root, {
		ignoreInitial: true,
		followSymlinks: false,
		ignored: (path) => {
			const parts = relative(config.root, path).split(sep);
			return (
				(!!parts[0] && !IdSchema.safeParse(parts[0]).success) ||
				parts[1] === "public" ||
				parts
					.slice(1)
					.some((part) => ["node_modules", ".git", ".celld"].includes(part))
			);
		},
	});
	watcher.on("all", (_event, path) => {
		const parts = relative(config.root, path).split(sep);
		const id = IdSchema.safeParse(parts[0]);
		if (!id.success) return;
		clearTimeout(debounce.get(id.data));
		debounce.set(
			id.data,
			setTimeout(() => {
				debounce.delete(id.data);
				void refresh(id.data);
			}, 100),
		);
	});
	watcher.on("error", (error) => {
		console.error(error);
		stop();
	});
	await new Promise<void>((done) => watcher?.once("ready", done));
	await scan();
	child = spawn(
		process.env.PI_FLARE_CELLD ?? "celld",
		[
			"dev",
			project,
			"--host",
			config.host,
			"--port",
			String(config.port),
			"--no-watch",
			"--logs",
		],
		{
			stdio: ["ignore", "inherit", "inherit"],
			env: {
				...process.env,
				CELLD_ESBUILD: esbuild,
				CELLD_V8_HEAP_LIMIT_MB: "128",
				CELLD_SHUTDOWN_TOTAL_MS: "5000",
			},
		},
	);
	child.on("error", (error) => {
		console.error(error);
		stop();
	});
	child.on("exit", (code) => {
		if (!stopping && !restoring) {
			console.error(`celld exited (${code})`);
			stop();
		}
	});
	for (let attempt = 0; attempt < 150 && !stopping; attempt++) {
		const response = await fetch(`${localUrl}/_flare/health`, {
			signal: AbortSignal.timeout(500),
		}).catch(() => undefined);
		if (response?.ok && (await response.text()) === service) {
			ready = true;
			console.log(`FLARE_READY ${publicUrl} (${config.root})`);
			backup();
			return;
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error("celld did not become ready");
}

// Bind before acquiring runtime resources: competing Pi launches lose harmlessly.
const server = serve(
	{ fetch: api.fetch, hostname: "127.0.0.1", port: config.controlPort },
	() => {
		void start().catch((error) => {
			console.error(error);
			stop();
		});
	},
);
server.on("error", (error: NodeJS.ErrnoException) => {
	console.error(
		error.code === "EADDRINUSE"
			? "Flare manager already bound; another session won startup"
			: error,
	);
	process.exit(error.code === "EADDRINUSE" ? 0 : 1);
});
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
