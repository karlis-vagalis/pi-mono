import assert from "node:assert/strict";
import {
	access,
	cp,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageRoot = resolve(process.argv[2] ?? ".");
const temporary = await mkdtemp(resolve(tmpdir(), "pi-flare-smoke-"));
const home = resolve(temporary, "home");
const copiedPackage = resolve(temporary, "package");
await cp(resolve(packageRoot, "dist"), resolve(copiedPackage, "dist"), {
	recursive: true,
});
await cp(
	resolve(packageRoot, "package.json"),
	resolve(copiedPackage, "package.json"),
);
// Bun hoists workspace dependencies; packed installations have their own.
let dependencyRoot = packageRoot;
for (;;) {
	const nodeModules = resolve(dependencyRoot, "node_modules");
	const available = await Promise.all(
		["zod", "typebox"].map((name) =>
			access(resolve(nodeModules, name, "package.json")).then(
				() => true,
				() => false,
			),
		),
	);
	if (available.every(Boolean)) {
		await symlink(nodeModules, resolve(copiedPackage, "node_modules"), "dir");
		break;
	}
	const parent = dirname(dependencyRoot);
	assert.notEqual(
		parent,
		dependencyRoot,
		"Install dependencies before running smoke checks",
	);
	dependencyRoot = parent;
}
const ports = [0, 1].map(() =>
	Bun.serve({ port: 0, fetch: () => new Response() }),
);
const [publicServer, controlServer] = ports;
assert(publicServer && controlServer);
process.env.PI_FLARE_HOME = home;
process.env.PI_FLARE_BACKUP_DIR = resolve(temporary, "backups");
process.env.PI_FLARE_HOST = "127.0.0.1";
process.env.PI_FLARE_PUBLIC_URL = `http://127.0.0.1:${publicServer.port}`;
process.env.PI_FLARE_PORT = String(publicServer.port);
process.env.PI_FLARE_CONTROL_PORT = String(controlServer.port);
const controlUrl = `http://127.0.0.1:${controlServer.port}`;
for (const server of ports) await server.stop(true);

type Tool = {
	name: string;
	execute: (
		id: string,
		input: Record<string, unknown>,
		signal: AbortSignal,
	) => Promise<{ structuredContent?: unknown }>;
};
type App = {
	id: string;
	directory: string;
	internalUrl: string;
	deployment: { status: string };
};
const tools = new Map<string, Tool>();
const handlers = new Map<string, () => Promise<void>>();
const api = {
	registerTool: (tool: Tool) => tools.set(tool.name, tool),
	registerCommand: (name: string) => assert.equal(name, "flare"),
	on: (event: string, handler: () => Promise<void>) =>
		handlers.set(event, handler),
} as unknown as ExtensionAPI;
const signal = AbortSignal.timeout(90_000);
let managerPid: number | undefined;
let managerStopped = false;

async function call(name: string, input: Record<string, unknown> = {}) {
	const tool = tools.get(`flare_${name}`);
	assert(tool, `Missing flare_${name}`);
	return (await tool.execute("smoke", input, signal)).structuredContent;
}
async function health() {
	const token = await readFile(resolve(home, "token"), "utf8");
	const response = await fetch(`${controlUrl}/health`, {
		headers: { authorization: `Bearer ${token}` },
	});
	assert(response.ok);
	return (await response.json()) as {
		pid: number;
		signature: string;
		reloadError?: string;
	};
}

try {
	const extension = (await import(
		pathToFileURL(resolve(copiedPackage, "dist/index.js")).href
	)) as typeof import("../src/index.ts");
	extension.default(api);
	assert.deepEqual(
		[...tools.keys()],
		["flare_create", "flare_list", "flare_get", "flare_update", "flare_delete"],
	);
	for (const template of ["static", "worker", "durable"]) {
		const app = (await call("create", {
			title: `Smoke ${template}`,
			template,
		})) as App;
		managerPid = (await health()).pid;
		assert.equal(app.deployment.status, "ready");
		assert.equal((await fetch(app.internalUrl)).status, 200);
		if (template === "worker") {
			const response = await fetch(new URL("api/hello", app.internalUrl));
			assert.deepEqual(await response.json(), { message: "Hello from Flare" });
		}
		if (template === "durable") {
			const url = new URL("api/count", app.internalUrl);
			assert.deepEqual(await (await fetch(url)).json(), { count: 0 });
			assert.deepEqual(await (await fetch(url, { method: "POST" })).json(), {
				count: 1,
			});
		}
		const updated = (await call("update", {
			id: app.id,
			title: "Updated",
		})) as App;
		assert.equal(updated.deployment.status, "ready");
		await call("delete", { id: app.id });
		assert.equal((await fetch(app.internalUrl)).status, 404);
	}
	assert.deepEqual(await call("list"), []);

	// A copied package exercises refresh without editing the repository's build.
	const before = await health();
	const runtimeFile = resolve(copiedPackage, "dist/runtime.js");
	await writeFile(
		runtimeFile,
		`${await readFile(runtimeFile, "utf8")}\n// Flare smoke refresh\n`,
	);
	await Bun.sleep(2500);
	await call("list");
	const after = await health();
	managerPid = after.pid;
	assert.notEqual(after.signature, before.signature);
	assert.notEqual(after.pid, before.pid);
	assert.equal(after.reloadError, undefined);
	console.log(
		"Flare smoke passed: compiled package, all templates, CRUD, durable state, automatic refresh.",
	);
} catch (error) {
	const log = await readFile(resolve(home, "runtime.log"), "utf8").catch(
		() => "",
	);
	console.error(log.slice(-12_000));
	throw error;
} finally {
	await handlers.get("session_shutdown")?.();
	// Wait for this test's leased manager to release its ports before cleanup.
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${controlUrl}/health`, {
				signal: AbortSignal.timeout(500),
			});
			await response.text();
			await Bun.sleep(100);
		} catch {
			managerStopped = true;
			break;
		}
	}
	if (!managerStopped && managerPid) {
		process.kill(managerPid, "SIGTERM");
		console.error(
			`Manager cleanup timed out; retained test data at ${temporary}`,
		);
	} else if (managerStopped) {
		await rm(temporary, { recursive: true, force: true });
	}
}
