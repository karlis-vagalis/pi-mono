import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	cp,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { type BackupSettings, containsPath } from "./schema.ts";
import { appIds } from "./storage.ts";

export const SnapshotTimeSchema = z
	.string()
	.regex(/^backup-\d+-[a-f0-9-]{36}$/)
	.transform((name) => Number(name.split("-")[1]))
	.pipe(z.number().int().nonnegative());
const sqliteHeader = Buffer.from("SQLite format 3\0");

export function backupRoot(settings: BackupSettings) {
	// Independent Flare homes can share a backup directory without mixing data.
	const key = createHash("sha256")
		.update(settings.root)
		.digest("hex")
		.slice(0, 16);
	return resolve(settings.backupDirectory, key);
}

async function latestBackup(settings: BackupSettings) {
	try {
		const entries = await readdir(backupRoot(settings), {
			withFileTypes: true,
		});
		let latest: number | undefined;
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const time = SnapshotTimeSchema.safeParse(entry.name);
			if (time.success) latest = Math.max(latest ?? 0, time.data);
		}
		return latest;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return undefined;
	}
}

async function copyState(source: string, destination: string) {
	await mkdir(destination, { recursive: true, mode: 0o700 });
	for (const entry of await readdir(source, { withFileTypes: true })) {
		// Never restore live SQLite sidecars alongside a standalone snapshot.
		if (/-(wal|shm|journal)$/.test(entry.name)) continue;
		const from = resolve(source, entry.name);
		const to = resolve(destination, entry.name);
		if (entry.isDirectory()) {
			await copyState(from, to);
			continue;
		}
		if (!entry.isFile())
			throw new Error(`Unsupported file in Flare durable state: ${from}`);
		const file = await open(from, "r");
		const header = Buffer.alloc(sqliteHeader.length);
		try {
			await file.read(header, 0, header.length, 0);
		} finally {
			await file.close();
		}
		if (header.equals(sqliteHeader)) {
			// SQLite serialization includes committed WAL pages and preserves
			// rowids. Copying a live .sqlite file alone can silently lose writes.
			const database = new Database(from, { readonly: true });
			try {
				await writeFile(to, database.serialize(), { mode: 0o600 });
			} finally {
				database.close();
			}
		} else {
			await copyFile(from, to);
		}
	}
}

export async function createBackup(settings: BackupSettings) {
	const base = backupRoot(settings);
	await mkdir(base, { recursive: true, mode: 0o700 });
	// Check canonical paths too: a configured symlink must not turn backups
	// into a recursive copy of their own destination.
	if (containsPath(await realpath(settings.root), await realpath(base)))
		throw new Error("Flare backups must be stored outside PI_FLARE_HOME");
	const temporary = resolve(base, `.partial-${randomUUID()}`);
	await mkdir(temporary, { mode: 0o700 });
	try {
		for (const id of await appIds(settings.root))
			await cp(resolve(settings.root, id), resolve(temporary, id), {
				recursive: true,
				dereference: false,
				verbatimSymlinks: true,
				preserveTimestamps: true,
			});
		const state = resolve(settings.root, "runtime/.celld/dev");
		let hasState = true;
		try {
			await realpath(state);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			// A new home may not have durable state yet; do not mutate the source.
			hasState = false;
		}
		const savedState = resolve(temporary, "runtime/.celld/dev");
		if (hasState) await copyState(state, savedState);
		else await mkdir(savedState, { recursive: true, mode: 0o700 });
		const completedAt = Date.now();
		await writeFile(
			resolve(temporary, "backup.json"),
			`${JSON.stringify({ version: 2, root: settings.root, completedAt }, null, 2)}\n`,
			{ mode: 0o600 },
		);
		const path = resolve(base, `backup-${completedAt}-${randomUUID()}`);
		// Only a completely written snapshot becomes visible to the scheduler.
		await rename(temporary, path);
		console.log(`FLARE_BACKUP ${path}`);
		return { path, completedAt };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

type Queue = (action: () => Promise<void>) => Promise<void>;

export class Backups {
	private running: Promise<void> | undefined;
	private nextAttempt = 0;

	constructor(
		private readonly settings: BackupSettings,
		private readonly queue: Queue = (action) => action(),
	) {}

	check(now = Date.now()): Promise<void> {
		if (this.running) return this.running;
		if (now < this.nextAttempt) return Promise.resolve();
		this.running = (async () => {
			const latest = await latestBackup(this.settings);
			if (
				latest !== undefined &&
				now < latest + this.settings.backupIntervalMs
			) {
				this.nextAttempt = latest + this.settings.backupIntervalMs;
				return;
			}
			await this.queue(async () => {
				const snapshot = await createBackup(this.settings);
				this.nextAttempt =
					snapshot.completedAt + this.settings.backupIntervalMs;
			});
		})()
			.catch((error) => {
				// Avoid hammering a full/unavailable disk on every maintenance tick.
				this.nextAttempt =
					now + Math.min(this.settings.backupIntervalMs, 60_000);
				throw error;
			})
			.finally(() => {
				this.running = undefined;
			});
		return this.running;
	}

	async wait() {
		await this.running;
	}
}
