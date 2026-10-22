import { lstat, readdir, rename, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type AppId, IdSchema } from "./schema.ts";

export async function hasAppManifest(directory: string) {
	try {
		await lstat(resolve(directory, "app.json"));
		return true;
	} catch (error) {
		if (
			!["ENOENT", "ENOTDIR"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			throw error;
		return false;
	}
}

// The home also holds runtime/control files. Only manifest-bearing directories
// are apps, including apps whose manifest is malformed and needs a build error.
export async function appIds(root: string): Promise<AppId[]> {
	const ids: AppId[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const id = IdSchema.safeParse(entry.name);
		if (
			entry.isDirectory() &&
			id.success &&
			(await hasAppManifest(resolve(root, id.data)))
		)
			ids.push(id.data);
	}
	return ids.sort();
}

export async function migrateApps(root: string) {
	const legacy = resolve(root, "apps");
	let entry: Awaited<ReturnType<typeof lstat>>;
	try {
		entry = await lstat(legacy);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return [];
	}
	if (entry.isSymbolicLink())
		throw new Error("Legacy Flare apps directory cannot be a symlink");
	// An app named "apps" is valid in the new layout, not a legacy container.
	if (!entry.isDirectory() || (await hasAppManifest(legacy))) return [];
	const ids = await appIds(legacy);
	// Check every destination before moving anything; never merge/overwrite apps.
	for (const id of ids) {
		try {
			await lstat(resolve(root, id));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new Error(
			`Cannot migrate Flare app ${id}: destination already exists`,
		);
	}
	for (const id of ids) await rename(resolve(legacy, id), resolve(root, id));
	try {
		// Leave any unrecognized files/directories alone, rather than deleting them.
		await rmdir(legacy);
	} catch (error) {
		if (
			!["ENOTEMPTY", "EEXIST"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			throw error;
	}
	return ids;
}
