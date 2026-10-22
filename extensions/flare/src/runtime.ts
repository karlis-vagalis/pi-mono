import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignatureSchema } from "./schema.ts";

const sourceFile = fileURLToPath(import.meta.url);
export const sourceRoot = dirname(sourceFile);
const extension = extname(sourceFile);
export const managerPath = resolve(sourceRoot, `manager${extension}`);
export const indexPath = resolve(sourceRoot, `index${extension}`);

// Read current files, not cached module exports; already-running clients agree
// on the version on disk even after a package update.
export async function signature() {
	const hash = createHash("sha256");
	const files = (await readdir(sourceRoot))
		.filter((file) => /\.(ts|js)$/.test(file))
		.sort();
	for (const file of files) {
		hash.update(file);
		hash.update("\0");
		hash.update(await readFile(resolve(sourceRoot, file)));
		hash.update("\0");
	}
	return SignatureSchema.parse(hash.digest("hex"));
}
