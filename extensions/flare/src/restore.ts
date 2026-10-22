import { randomUUID } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";
import { backupRoot, createBackup, SnapshotTimeSchema } from "./backup.ts";
import type { BackupSettings } from "./schema.ts";
import { appIds } from "./storage.ts";

const MetadataSchema = z.object({
	version: z.union([z.literal(1), z.literal(2)]),
	root: z.string(),
	completedAt: z.number().int().nonnegative(),
});

// Only this parser constructs a restore source, confined to this home's backups.
export async function readBackup(settings: BackupSettings, name: string) {
	const base = await realpath(backupRoot(settings));
	const path = await realpath(resolve(base, name));
	if (
		dirname(path) !== base ||
		!SnapshotTimeSchema.safeParse(basename(path)).success
	)
		throw new Error("Choose a backup from this Flare home's backup directory");
	const metadata = MetadataSchema.parse(
		JSON.parse(await readFile(resolve(path, "backup.json"), "utf8")),
	);
	if (metadata.root !== settings.root)
		throw new Error("This backup belongs to a different Flare home");
	const apps = metadata.version === 1 ? resolve(path, "apps") : path;
	const state = resolve(path, "runtime/.celld/dev");
	for (const directory of [apps, state]) {
		if (
			(await realpath(directory)) !== directory ||
			!(await stat(directory)).isDirectory()
		)
			throw new Error(
				"Backup is incomplete or contains a symlinked data directory",
			);
	}
	return {
		info: { path, completedAt: metadata.completedAt },
		apps: (await appIds(apps)).map((id) => ({ id, path: resolve(apps, id) })),
		state,
	};
}

type RestoreSource = Awaited<ReturnType<typeof readBackup>>;

/** The caller must stop celld and drain app mutations before restoring. */
export async function restoreBackup(
	settings: BackupSettings,
	source: RestoreSource,
) {
	const current = new Set(await appIds(settings.root));
	const saved = new Set(source.apps.map((app) => app.id));
	// Restoring apps must not replace control files or unrelated root directories.
	for (const id of saved) {
		if (current.has(id)) continue;
		try {
			await lstat(resolve(settings.root, id));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new Error(
			`Cannot restore Flare app ${id}: destination already exists`,
		);
	}
	const staging = resolve(settings.root, `.restore-${randomUUID()}`);
	await mkdir(staging, { mode: 0o700 });
	const replacements = [
		...[...new Set([...current, ...saved])].map((id) => ({
			live: resolve(settings.root, id),
			saved: saved.has(id) ? resolve(staging, "incoming", id) : undefined,
			previous: resolve(staging, "previous", id),
		})),
		{
			live: resolve(settings.root, "runtime/.celld/dev"),
			saved: resolve(staging, "state"),
			previous: resolve(staging, "previous-state"),
		},
	];
	const moved: {
		replacement: (typeof replacements)[number];
		hadPrevious: boolean;
	}[] = [];
	let canClean = true;
	try {
		const options = {
			recursive: true,
			dereference: false,
			verbatimSymlinks: true,
			preserveTimestamps: true,
		};
		await mkdir(resolve(staging, "incoming"));
		await mkdir(resolve(staging, "previous"));
		for (const app of source.apps)
			await cp(app.path, resolve(staging, "incoming", app.id), options);
		await cp(source.state, resolve(staging, "state"), options);
		// Do not touch live data unless its recovery snapshot has succeeded.
		const recovery = await createBackup(settings);
		for (const replacement of replacements) {
			let hadPrevious = false;
			try {
				await rename(replacement.live, replacement.previous);
				hadPrevious = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			moved.push({ replacement, hadPrevious });
			canClean = false;
			if (replacement.saved) {
				await mkdir(dirname(replacement.live), { recursive: true });
				await rename(replacement.saved, replacement.live);
			}
		}
		canClean = true;
		return { restored: source.info, recovery };
	} catch (error) {
		canClean = false;
		for (const { replacement, hadPrevious } of moved.reverse()) {
			try {
				await rename(
					replacement.live,
					resolve(staging, `.discarded-${randomUUID()}`),
				);
			} catch (rollbackError) {
				if ((rollbackError as NodeJS.ErrnoException).code !== "ENOENT")
					throw rollbackError;
			}
			if (hadPrevious) await rename(replacement.previous, replacement.live);
		}
		canClean = true;
		throw error;
	} finally {
		// If a rollback itself failed, retain the previous trees for recovery.
		if (canClean) await rm(staging, { recursive: true, force: true });
	}
}
