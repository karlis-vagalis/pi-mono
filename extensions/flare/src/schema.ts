import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const IdSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(63)
	.refine(
		(id) => !["runtime", "token"].includes(id),
		"App ID is reserved by Flare",
	)
	.brand<"AppId">();
export type AppId = z.infer<typeof IdSchema>;
export const LeaseIdSchema = z.uuid().brand<"LeaseId">();
export type LeaseId = z.infer<typeof LeaseIdSchema>;
const identifier = z
	.string()
	.regex(/^[A-Za-z_$][\w$]*$/)
	.max(63);
const relativePath = z
	.string()
	.regex(/^[\w.-]+(?:\/[\w.-]+)*$/)
	.refine(
		(path) => !path.split("/").some((part) => part === "." || part === ".."),
	)
	.brand<"AppPath">();
const ExpiresAtSchema = z
	.number()
	.int()
	.nonnegative()
	.max(8_640_000_000_000_000)
	.brand<"ExpiresAt">();
export const LifetimeSchema = z.object({
	expiresAt: ExpiresAtSchema.nullable().default(null),
});
const ttlSeconds = z
	.number()
	.int()
	.positive()
	.brand<"TtlSeconds">()
	.nullable()
	.optional()
	.describe("Positive lifetime in seconds, or null for no expiry.");
const deadline = (seconds: z.output<typeof ttlSeconds>) =>
	seconds == null ? null : ExpiresAtSchema.parse(Date.now() + seconds * 1000);
const metadata = {
	title: z.string().trim().min(1).max(200),
	description: z.string().max(2000).default(""),
	...LifetimeSchema.shape,
};
export const ManifestSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("static"), ...metadata }),
	z.strictObject({
		type: z.literal("worker"),
		...metadata,
		entry: relativePath.prefault("worker.ts"),
		objects: z.array(identifier).max(32).default([]),
		vars: z.record(identifier, z.string()).default({}),
	}),
]);
export type Manifest = z.infer<typeof ManifestSchema>;
export type Published =
	| { manifest: Extract<Manifest, { type: "static" }>; revision: string }
	| {
			manifest: Extract<Manifest, { type: "worker" }>;
			revision: string;
			source: string;
	  };

export const CreateSchema = z
	.strictObject({
		title: metadata.title,
		description: metadata.description,
		template: z.enum(["static", "worker", "durable"]).default("static"),
		ttl_seconds: ttlSeconds,
	})
	.transform(({ ttl_seconds, ...input }) => ({
		...input,
		expiresAt: deadline(ttl_seconds),
	}));
export const UpdateSchema = z
	.strictObject({
		id: IdSchema,
		title: metadata.title.optional(),
		description: metadata.description.unwrap().optional(),
		ttl_seconds: ttlSeconds,
	})
	.transform(({ ttl_seconds, ...input }) => ({
		...input,
		expiresAt: ttl_seconds === undefined ? undefined : deadline(ttl_seconds),
	}));
export const LookupSchema = z.strictObject({ id: IdSchema });
export const InfoSchema = z.object({
	id: IdSchema,
	directory: z.string(),
	url: z
		.url()
		.describe(
			"Public app base URL with trailing slash. Resolve frontend API and asset URLs against this base, not the shared origin root.",
		),
	internalUrl: z
		.url()
		.describe(
			"Internal app base URL with trailing slash, reachable at the local Flare bind.",
		),
	...LifetimeSchema.shape,
	deployment: z.discriminatedUnion("status", [
		z.object({
			status: z.literal("ready"),
			manifest: ManifestSchema,
			revision: z.string(),
		}),
		z.object({
			status: z.literal("error"),
			error: z.string(),
			servingRevision: z.string().optional(),
		}),
	]),
});
export type AppInfo = z.infer<typeof InfoSchema>;
export const service = "pi-flare";
export const SignatureSchema = z
	.string()
	.regex(/^[a-f0-9]{64}$/)
	.brand<"RuntimeSignature">();
export const LeaseSnapshotSchema = z.array(
	z.tuple([LeaseIdSchema, z.number().int().nonnegative()]),
);
const bindAddress = z.union([z.ipv4(), z.ipv6()]).brand<"BindAddress">();
export const defaultBackupDirectory = resolve(homedir(), ".pi/flare-backups");
export const defaultBackupIntervalMs = 12 * 60 * 60 * 1000;
export const HealthSchema = z.object({
	service: z.literal(service),
	host: bindAddress.prefault("127.0.0.1"),
	root: z.string(),
	port: z.number(),
	signature: SignatureSchema,
	sourceRoot: z.string(),
	publicUrl: z.string(),
	pid: z.number().int().positive(),
	leases: z.number().int().nonnegative(),
	backupDirectory: z.string().optional(),
	backupIntervalMs: z.number().int().positive().optional(),
	reloadError: z.string().optional(),
});
const port = z.coerce.number().int().min(1024).max(65535);
const baseUrl = z.url().refine((value) => {
	const url = new URL(value);
	return /^(https?:)$/.test(url.protocol) && !url.search && !url.hash;
});
export function containsPath(parent: string, child: string) {
	const path = relative(parent, child);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

export const ConfigSchema = z
	.object({
		root: z
			.string()
			.default(`${homedir()}/.pi/flare`)
			.transform((value) => resolve(value)),
		host: bindAddress.prefault("127.0.0.1"),
		port: port.default(53762),
		controlPort: port.default(53763),
		publicUrl: baseUrl.optional(),
		backupDirectory: z
			.string()
			.trim()
			.min(1)
			.default(defaultBackupDirectory)
			.transform((value) => resolve(value)),
		// Parse hours at the environment boundary; scheduling uses milliseconds.
		backupIntervalHours: z.coerce
			.number()
			.positive()
			.default(12)
			.transform((hours) => Math.round(hours * 60 * 60 * 1000))
			.pipe(z.number().int().positive())
			.brand<"BackupIntervalMs">(),
	})
	.refine(
		(value) => value.port !== value.controlPort,
		"Flare ports must differ",
	)
	.refine(
		(value) => !containsPath(value.root, value.backupDirectory),
		"Flare backups must be stored outside PI_FLARE_HOME",
	)
	.transform(({ backupIntervalHours, ...settings }) => ({
		...settings,
		backupIntervalMs: backupIntervalHours,
	}));
export const config = ConfigSchema.parse({
	root: process.env.PI_FLARE_HOME,
	host: process.env.PI_FLARE_HOST,
	port: process.env.PI_FLARE_PORT,
	controlPort: process.env.PI_FLARE_CONTROL_PORT,
	publicUrl: process.env.PI_FLARE_PUBLIC_URL,
	backupDirectory: process.env.PI_FLARE_BACKUP_DIR,
	backupIntervalHours: process.env.PI_FLARE_BACKUP_INTERVAL_HOURS,
});
export const BackupInfoSchema = z.object({
	path: z.string(),
	completedAt: z.number().int().nonnegative(),
});
export type BackupInfo = z.infer<typeof BackupInfoSchema>;
export const RestoreSchema = z.strictObject({
	backup: z.string().trim().min(1).max(4096),
});
export const RestoreInfoSchema = z.object({
	restored: BackupInfoSchema,
	recovery: BackupInfoSchema,
});
export type BackupSettings = Pick<
	typeof config,
	"root" | "backupDirectory" | "backupIntervalMs"
>;
export const controlUrl = `http://127.0.0.1:${config.controlPort}`;
const connectAddress =
	config.host === "0.0.0.0"
		? "127.0.0.1"
		: config.host === "::"
			? "::1"
			: config.host;
export const localUrl = `http://${connectAddress.includes(":") ? `[${connectAddress}]` : connectAddress}:${config.port}`;
export const publicUrl = (config.publicUrl ?? localUrl).replace(/\/+$/, "");
export const tokenPath = resolve(config.root, "token");
export const TokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const esbuild = process.env.CELLD_ESBUILD ?? "esbuild";
export const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);
