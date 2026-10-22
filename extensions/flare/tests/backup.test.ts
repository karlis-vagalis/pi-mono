import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBackup } from "../src/backup.ts";
import { readBackup, restoreBackup } from "../src/restore.ts";
import { ConfigSchema } from "../src/schema.ts";

let temporary: string;
beforeEach(async () => {
	temporary = await mkdtemp(resolve(tmpdir(), "pi-flare-backup-"));
});
afterEach(async () => {
	await rm(temporary, { recursive: true, force: true });
});

async function fixture() {
	const settings = ConfigSchema.parse({
		root: resolve(temporary, "home"),
		backupDirectory: resolve(temporary, "backups"),
	});
	await mkdir(resolve(settings.root, "bright-otter"), { recursive: true });
	await writeFile(
		resolve(settings.root, "bright-otter/app.json"),
		'{"type":"static","title":"Original"}',
	);
	await mkdir(resolve(settings.root, "runtime/.celld/dev"), {
		recursive: true,
	});
	await writeFile(resolve(settings.root, "token"), "private-token");
	return settings;
}

test("snapshots committed SQLite WAL data without credentials or sidecars", async () => {
	const settings = await fixture();
	const database = new Database(
		resolve(settings.root, "runtime/.celld/dev/state.sqlite"),
	);
	try {
		database.exec(
			"PRAGMA journal_mode=WAL; CREATE TABLE counter (value INTEGER); INSERT INTO counter VALUES (42)",
		);
		const snapshot = await createBackup(settings);
		expect(await readdir(snapshot.path)).toEqual(
			expect.arrayContaining(["backup.json", "bright-otter", "runtime"]),
		);
		expect(await readdir(snapshot.path)).not.toContain("token");
		expect(await readdir(resolve(snapshot.path, "runtime/.celld/dev"))).toEqual(
			["state.sqlite"],
		);
		const saved = new Database(
			resolve(snapshot.path, "runtime/.celld/dev/state.sqlite"),
			{ readonly: true },
		);
		try {
			expect(saved.query("SELECT value FROM counter").get()).toEqual({
				value: 42,
			});
		} finally {
			saved.close();
		}
	} finally {
		database.close();
	}
});

test("restores apps and state while keeping the token and a recovery snapshot", async () => {
	const settings = await fixture();
	const snapshot = await createBackup(settings);
	await writeFile(
		resolve(settings.root, "bright-otter/app.json"),
		'{"type":"static","title":"Changed"}',
	);
	const source = await readBackup(settings, snapshot.path);
	const restored = await restoreBackup(settings, source);
	expect(
		JSON.parse(
			await readFile(resolve(settings.root, "bright-otter/app.json"), "utf8"),
		).title,
	).toBe("Original");
	expect(await readFile(resolve(settings.root, "token"), "utf8")).toBe(
		"private-token",
	);
	expect(restored.recovery.path).not.toBe(snapshot.path);
	const recovery = await readBackup(settings, restored.recovery.path);
	expect(
		JSON.parse(
			await readFile(
				resolve(recovery.info.path, "bright-otter/app.json"),
				"utf8",
			),
		).title,
	).toBe("Changed");
});

test("rejects a snapshot outside this home's backup directory", async () => {
	const settings = await fixture();
	await createBackup(settings);
	await expect(readBackup(settings, temporary)).rejects.toThrow(
		"Choose a backup",
	);
});
