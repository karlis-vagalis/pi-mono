import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	ConfigSchema,
	CreateSchema,
	IdSchema,
	ManifestSchema,
	service,
	UpdateSchema,
} from "../src/schema.ts";

describe("Flare configuration", () => {
	test("preserves the original Flare defaults", () => {
		const settings = ConfigSchema.parse({});
		expect(settings.root).toBe(resolve(homedir(), ".pi/flare"));
		expect(settings.backupDirectory).toBe(
			resolve(homedir(), ".pi/flare-backups"),
		);
		expect(service).toBe("pi-flare");
		expect<number>(settings.backupIntervalMs).toBe(12 * 60 * 60 * 1000);
		expect(settings.backupKeep).toBe(0);
	});

	test("parses ports and fractional backup hours", () => {
		const settings = ConfigSchema.parse({
			port: "54000",
			backupIntervalHours: "0.5",
		});
		expect(settings.port).toBe(54000);
		expect<number>(settings.backupIntervalMs).toBe(1_800_000);
	});

	test("parses backup retention counts with zero meaning unlimited", () => {
		expect(ConfigSchema.parse({ backupKeep: "1" }).backupKeep).toBe(1);
		expect(ConfigSchema.parse({ backupKeep: "3" }).backupKeep).toBe(3);
		expect(ConfigSchema.parse({ backupKeep: "0" }).backupKeep).toBe(0);
	});

	test("rejects invalid backup retention counts", () => {
		for (const backupKeep of [
			-1,
			1.5,
			"invalid",
			Infinity,
			Number.MAX_SAFE_INTEGER + 1,
		])
			expect(() => ConfigSchema.parse({ backupKeep })).toThrow();
	});

	test("rejects conflicting ports and backups inside the home", () => {
		expect(() =>
			ConfigSchema.parse({ port: 54000, controlPort: 54000 }),
		).toThrow();
		expect(() =>
			ConfigSchema.parse({
				root: "/tmp/flare",
				backupDirectory: "/tmp/flare/backups",
			}),
		).toThrow();
	});
});

describe("app boundaries", () => {
	test("parses static and worker defaults", () => {
		expect(ManifestSchema.parse({ type: "static", title: "Example" })).toEqual({
			type: "static",
			title: "Example",
			description: "",
			expiresAt: null,
		});
		const app = ManifestSchema.parse({ type: "worker", title: "Example" });
		expect(app).toMatchObject({ entry: "worker.ts", objects: [], vars: {} });
	});

	test("rejects unsafe entry paths and unknown manifest properties", () => {
		for (const entry of [
			"../secret.ts",
			"/tmp/secret.ts",
			"src/../secret.ts",
		]) {
			expect(() =>
				ManifestSchema.parse({ type: "worker", title: "Example", entry }),
			).toThrow();
		}
		expect(() =>
			ManifestSchema.parse({
				type: "static",
				title: "Example",
				unexpected: true,
			}),
		).toThrow();
	});

	test("rejects reserved and escaping IDs", () => {
		for (const id of ["runtime", "token", "../secret", "UPPER", "bad_id", ""]) {
			expect(IdSchema.safeParse(id).success).toBe(false);
		}
		expect<string>(IdSchema.parse("bright-otter")).toBe("bright-otter");
	});

	test("creates permanent apps by default and future TTL deadlines", () => {
		expect(CreateSchema.parse({ title: "Permanent" }).expiresAt).toBeNull();
		const before = Date.now();
		const deadline = CreateSchema.parse({
			title: "Temporary",
			ttl_seconds: 60,
		}).expiresAt;
		expect(deadline).toBeGreaterThanOrEqual(before + 60_000);
		expect(() =>
			CreateSchema.parse({ title: "Invalid", ttl_seconds: 0 }),
		).toThrow();
	});

	test("distinguishes omitted TTL from explicitly clearing it", () => {
		expect(
			UpdateSchema.parse({ id: "bright-otter" }).expiresAt,
		).toBeUndefined();
		expect(
			UpdateSchema.parse({ id: "bright-otter", ttl_seconds: null }).expiresAt,
		).toBeNull();
	});
});
