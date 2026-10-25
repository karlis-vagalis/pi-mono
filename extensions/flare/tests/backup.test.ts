import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { Backups, backupRoot, createBackup } from "../src/backup.ts";
import { readBackup, restoreBackup } from "../src/restore.ts";
import { type BackupSettings, ConfigSchema } from "../src/schema.ts";

let temporary: string;
beforeEach(async () => {
	temporary = await mkdtemp(resolve(tmpdir(), "pi-flare-backup-"));
});
afterEach(async () => {
	await rm(temporary, { recursive: true, force: true });
});

async function fixture(backupKeep = 0) {
	const settings = ConfigSchema.parse({
		root: resolve(temporary, "home"),
		backupDirectory: resolve(temporary, "backups"),
		backupKeep,
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

async function olderSnapshot(
	settings: BackupSettings,
	completedAt: number,
	root = settings.root,
) {
	const path = resolve(
		backupRoot(settings),
		`backup-${completedAt}-${randomUUID()}`,
	);
	await mkdir(resolve(path, "runtime/.celld/dev"), { recursive: true });
	await writeFile(
		resolve(path, "backup.json"),
		JSON.stringify({
			version: 2,
			root,
			completedAt,
		}),
	);
	return path;
}

test("retains every backup by default", async () => {
	const settings = await fixture();
	const snapshots = [
		await createBackup(settings),
		await createBackup(settings),
		await createBackup(settings),
	];
	expect((await readdir(backupRoot(settings))).sort()).toEqual(
		snapshots.map((snapshot) => basename(snapshot.path)).sort(),
	);
});

test("a retention count of one keeps only the just-completed backup", async () => {
	const settings = await fixture(1);
	await createBackup(settings);
	await createBackup(settings);
	const newest = await createBackup(settings);
	expect(await readdir(backupRoot(settings))).toEqual([basename(newest.path)]);
});

test("retains the requested count, sorting older snapshots numerically", async () => {
	const settings = await fixture(2);
	const oldest = await olderSnapshot(settings, 9);
	const recent = await olderSnapshot(settings, 10);
	const newest = await createBackup(settings);
	expect((await readdir(backupRoot(settings))).sort()).toEqual(
		[recent, newest.path].map((path) => basename(path)).sort(),
	);
	await expect(lstat(oldest)).rejects.toMatchObject({ code: "ENOENT" });
});

test("keeps the new snapshot even when an older backup has a future timestamp", async () => {
	const settings = await fixture(1);
	await olderSnapshot(settings, Date.now() + 60_000);
	const newest = await createBackup(settings);
	expect(await readdir(backupRoot(settings))).toEqual([basename(newest.path)]);
});

test("scheduled backups enforce the same retention limit", async () => {
	const settings = await fixture(1);
	await olderSnapshot(settings, 1);
	await olderSnapshot(settings, 2);
	await new Backups(settings).check();
	expect(await readdir(backupRoot(settings))).toHaveLength(1);
});

test("a failed snapshot does not prune previous backups", async () => {
	const settings = await fixture(1);
	const previous = await createBackup(settings);
	await symlink(
		resolve(settings.root, "token"),
		resolve(settings.root, "runtime/.celld/dev/unsupported-link"),
	);
	await expect(createBackup(settings)).rejects.toThrow("Unsupported file");
	expect(await readdir(backupRoot(settings))).toEqual([
		basename(previous.path),
	]);
});

test("retention leaves other homes, incomplete snapshots, and symlinks alone", async () => {
	const settings = await fixture(1);
	const other = ConfigSchema.parse({
		root: resolve(temporary, "other-home"),
		backupDirectory: settings.backupDirectory,
	});
	await mkdir(other.root);
	const otherBackup = await createBackup(other);
	const foreign = await olderSnapshot(settings, 1, other.root);
	const malformed = await olderSnapshot(settings, 2);
	await writeFile(resolve(malformed, "backup.json"), "{invalid JSON");
	const incomplete = resolve(backupRoot(settings), `backup-3-${randomUUID()}`);
	await mkdir(incomplete);
	const linked = resolve(backupRoot(settings), `backup-4-${randomUUID()}`);
	await symlink(otherBackup.path, linked);
	const linkedMarker = await olderSnapshot(settings, 5);
	await rm(resolve(linkedMarker, "backup.json"));
	await symlink(
		resolve(foreign, "backup.json"),
		resolve(linkedMarker, "backup.json"),
	);
	const partial = resolve(backupRoot(settings), ".partial-unfinished");
	await mkdir(partial);
	await olderSnapshot(settings, 6);
	const newest = await createBackup(settings);
	expect((await readdir(backupRoot(settings))).sort()).toEqual(
		[foreign, malformed, incomplete, linked, linkedMarker, partial, newest.path]
			.map((path) => basename(path))
			.sort(),
	);
	expect((await lstat(linked)).isSymbolicLink()).toBe(true);
	expect((await lstat(otherBackup.path)).isDirectory()).toBe(true);
});

test("restore stages its source before pruning and retains the recovery snapshot", async () => {
	const settings = await fixture(1);
	const snapshot = await createBackup(settings);
	await writeFile(
		resolve(settings.root, "bright-otter/app.json"),
		'{"type":"static","title":"Changed"}',
	);
	const restored = await restoreBackup(
		settings,
		await readBackup(settings, snapshot.path),
	);
	expect(
		JSON.parse(
			await readFile(resolve(settings.root, "bright-otter/app.json"), "utf8"),
		).title,
	).toBe("Original");
	expect(await readdir(backupRoot(settings))).toEqual([
		basename(restored.recovery.path),
	]);
	expect(
		JSON.parse(
			await readFile(
				resolve(restored.recovery.path, "bright-otter/app.json"),
				"utf8",
			),
		).title,
	).toBe("Changed");
	await expect(lstat(snapshot.path)).rejects.toMatchObject({ code: "ENOENT" });
});
