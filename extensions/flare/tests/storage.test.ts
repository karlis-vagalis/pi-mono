import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appIds, migrateApps } from "../src/storage.ts";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(resolve(tmpdir(), "pi-flare-storage-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function app(path: string) {
	await mkdir(path, { recursive: true });
	await writeFile(
		resolve(path, "app.json"),
		'{"type":"static","title":"Example"}',
	);
}

describe("filesystem discovery", () => {
	test("discovers only manifest-bearing app directories", async () => {
		await app(resolve(root, "bright-otter"));
		await app(resolve(root, "runtime"));
		await mkdir(resolve(root, "unrelated"));
		await symlink(resolve(root, "bright-otter"), resolve(root, "linked-app"));
		expect<string[]>(await appIds(root)).toEqual(["bright-otter"]);
	});

	test("moves legacy apps without touching unrelated files", async () => {
		await app(resolve(root, "apps/bright-otter"));
		await writeFile(resolve(root, "apps/notes.txt"), "Keep me");
		expect<string[]>(await migrateApps(root)).toEqual(["bright-otter"]);
		expect<string[]>(await appIds(root)).toEqual(["bright-otter"]);
		expect(await readFile(resolve(root, "apps/notes.txt"), "utf8")).toBe(
			"Keep me",
		);
	});

	test("checks all migration conflicts before moving any apps", async () => {
		await app(resolve(root, "apps/alpha-app"));
		await app(resolve(root, "apps/beta-app"));
		await mkdir(resolve(root, "beta-app"));
		await expect(migrateApps(root)).rejects.toThrow(
			"destination already exists",
		);
		expect<string[]>(await appIds(resolve(root, "apps"))).toEqual([
			"alpha-app",
			"beta-app",
		]);
		expect<string[]>(await appIds(root)).toEqual([]);
	});

	test("does not treat an actual app named apps as a legacy container", async () => {
		await app(resolve(root, "apps"));
		expect<string[]>(await migrateApps(root)).toEqual([]);
		expect<string[]>(await appIds(root)).toEqual(["apps"]);
	});
});
