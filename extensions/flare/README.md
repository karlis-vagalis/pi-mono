# pi-flare

Filesystem-first microapps for the [pi coding agent](https://pi.dev/), powered by
one shared local [celld](https://celld.dev/) runtime.

Create static sites, Workers, and durable apps from your Pi session. Edit their
files directly; changes go live automatically. No cloud credentials, app registry
database, per-app ports, or manual deployments.

## Requirements

- Pi running on Node.js 22.12 or newer.
- [Bun](https://bun.sh/) 1.3.10 or newer on `PATH` (runs the shared manager and SQLite backups).
- [celld](https://celld.dev/) on `PATH` (tested with 0.6.2).
- `esbuild` on `PATH` (tested with 0.28.2; install with `bun add --global esbuild`).

celld is an external runtime, not an npm dependency bundled with this extension.
Follow its platform-specific installation instructions.

## Install

Once published:

```bash
pi install npm:@karlis-vagalis/pi-flare
```

From the pi-mono repository root, build this workspace before installing:

```bash
bun install
bun run --filter @karlis-vagalis/pi-flare build
pi install ./extensions/flare
```

Run `/reload` in Pi after installation, then `/flare` to start the runtime.

### Coming from pi-lib

This is the same extension previously bundled under `extensions/flare`.
The `/flare` command, `flare_*` tools, `PI_FLARE_*` settings, default ports,
app URLs, manifests, data directories, and backup format are unchanged.
Existing apps and backups remain in `~/.pi/flare` and `~/.pi/flare-backups`;
no data migration is needed.

Do not load both copies. Close Pi sessions using the old runtime before switching
to the standalone package. The manager records its extension source location, so
a running manager from the old checkout must shut down before the new package can
use the same ports. Your data is retained.

## Usage

Reload Pi after installing this package. `/flare` starts or attaches to the runtime
and shows app URLs. Open `http://127.0.0.1:53762/` to browse the app directory,
which lists unexpired
apps, build status, and lifetime, with Light / Dark / System appearance modes.
Reload the page to refresh the list. Apps live directly at `/<id>/`; `/<id>`
redirects to `/<id>/` while preserving the query string.
The agent has these tools:

| Tool           | Purpose                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `flare_create` | Scaffold a `static`, `worker`, or `durable` app; return its directory and URL |
| `flare_list`   | List apps and build status                                                    |
| `flare_get`    | Read a manifest, paths, revision, or build error                              |
| `flare_update` | Update title, description, or expiry in `app.json`                            |
| `flare_delete` | Remove an app's source directory; retain durable data                         |

Creation takes `title`, optional `description`, and optional `template` (default:
`static`). IDs are collision-checked Faker adjective–noun names, such as
`brave-otter`. Use normal `read`, `write`, `edit`, and `bash` tools on the returned
directory. You can also create app directories manually directly under
`PI_FLARE_HOME` using the same convention. `runtime` and `token` are reserved IDs.
Only directories containing `app.json` are discovered as apps.

### Optional TTL

Apps live forever by default. Pass positive integer `ttl_seconds` to
`flare_create` for a temporary app. On `flare_update`, a number resets expiry
from now, `null` clears it (forever), and omitting it preserves the current expiry.

```javascript
flare_create({ title: "Temporary preview", ttl_seconds: 3600 });
flare_update({ id: "brave-otter", ttl_seconds: 7200 }); // extend from now
flare_update({ id: "brave-otter", ttl_seconds: null }); // keep forever
```

The returned `expiresAt` is an absolute Unix timestamp in milliseconds or `null`.
It is stored in `app.json`, so downtime counts toward TTL; edit that field directly
to change expiry too. Removing it or setting it to `null` means forever. Expired
URLs return 404 immediately. While Flare runs, a one-second sweep removes expired
source directories; after downtime, overdue apps are removed on startup.
Cleanup retains durable data, exactly like `flare_delete`. Unreadable or malformed
expiry metadata is not automatically deleted until it can be parsed safely.

```text
~/.pi/flare/
├── brave-otter/
│   ├── app.json
│   ├── worker.ts          # backend apps only
│   └── public/index.html
├── runtime/               # generated gateway; never edit this
│   └── .celld/dev/        # persistent celld data, excluded from app discovery/watch
├── runtime.log
├── leases.json            # temporary session handoff during runtime refresh
└── token                  # private manager authentication
```

### Existing homes

On startup, Flare automatically moves apps from the old `PI_FLARE_HOME/apps/<id>/`
layout to `PI_FLARE_HOME/<id>/`. Every destination is checked first; a conflict
stops startup without overwriting anything. Resolve conflicts and retry. The old
container is removed only if empty; unrecognized files and directories are left
untouched. An actual root-level app named `apps` is not treated as a container.

The old `/apps/<id>/` URLs are not aliases. Update bookmarks and any hard-coded
mount paths in existing app source to `/<id>/`. Relative frontend requests such
as `fetch("./api/count")` keep working. Migration does not rewrite app source or
change app IDs, so durable data retains its identity.

## Backups and restore

While the shared runtime is running, Flare takes a backup every **12 hours** by
default. Set `PI_FLARE_BACKUP_INTERVAL_HOURS` to a positive number of hours
(fractions are supported), and `PI_FLARE_BACKUP_DIR` to change the shared backup
folder (default: `~/.pi/flare-backups`). The folder must be outside
`PI_FLARE_HOME`, including when symlinks are resolved.

```bash
PI_FLARE_BACKUP_INTERVAL_HOURS=6 PI_FLARE_BACKUP_DIR=/mnt/backups/flare pi
```

Backups are private, timestamped directories grouped by a hash of the Flare home:

```text
~/.pi/flare-backups/<home-hash>/backup-<timestamp-ms>-<uuid>/
├── backup.json            # original home, format version, completion time
├── brave-otter/           # each app directly in the snapshot root
└── runtime/.celld/dev/    # durable state, including deleted apps' databases
```

SQLite databases are snapshotted through SQLite, including committed WAL data;
raw live database files and their transient WAL/SHM/journal sidecars are not copied.
Snapshots are published only after all files have been written. Credentials,
leases, logs, and generated runtime code are excluded. Old backups are **never
pruned automatically**; monitor disk usage and remove snapshots you no longer need.
A local backup protects against accidental changes, not loss of the whole disk;
choose another disk or a backed-up mount for stronger protection.

Scheduling is shared by all connected Pi instances, with no overlapping scheduled
runs. Completion timestamps survive runtime restarts. A new home gets its first
backup when Flare starts; an overdue backup catches up on the next start. No
backups run while Flare is stopped. Failures are logged to `runtime.log` and
retried after at most one minute without stopping apps. Normal scheduled backups
do not restart celld; individual databases are consistent, but source edits and
writes across multiple databases are not one global point-in-time transaction.
Expired apps removed during startup cleanup are not included in that start's backup.

### Commands

```text
/flare backup
/flare restore backup-<timestamp-ms>-<uuid>
/flare restore /absolute/path/to/the/backup-directory
```

`/flare backup` creates a snapshot immediately, regardless of the schedule, and
shows its path plus the corresponding restore command. Find older snapshot names
under the shared backup folder or in `runtime.log`.

`/flare restore <name-or-path>` restores **all apps and durable data**, not a
single app. Only backups belonging to the current Flare home and stored under its
backup folder are accepted. Interactive sessions ask for confirmation. The current
agent must be idle; pause other agents/editors writing app files too. Flare
pauses builds, gracefully stops celld, makes a **recovery backup of the current
state**, then replaces the app and durable-state trees rather than merging them
with stale databases. A failed replacement attempts to roll back the old trees.
The shared runtime restarts afterward, briefly interrupting every connected Flare
session and any live WebSocket connections. The command reports the recovery
snapshot, which can itself be restored to undo the operation.

The manager token, configuration, and unrelated root directories stay unchanged.
A restored app cannot overwrite an unrelated directory with the same name.
Restored expiry timestamps stay unchanged too: already-expired apps will be
removed again on startup. New backups use format version 2 with root-level app
directories; version 1 backups with an `apps/` container remain restorable into
the new layout.

## Routing

The returned `url` is the **app base**, with a trailing slash, for example
`http://127.0.0.1:53762/brave-otter/`. Apps share an origin but each has its own
`/<id>/` mount. The gateway removes that mount before invoking the Worker:

| Public request                 | Worker pathname    |
| ------------------------------ | ------------------ |
| `/brave-otter/`                | `/`                |
| `/brave-otter/api/count`       | `/api/count`       |
| `/brave-otter/images/logo.svg` | `/images/logo.svg` |

Both frontend forms below are correct **from the app homepage**:

```javascript
fetch("./api/count"); // relative to the homepage
fetch("/brave-otter/api/count"); // full root-relative mount path
```

`fetch("/api/count")` instead targets the shared origin root, outside the app,
and returns 404. A leading slash is valid; it just requires the public mount
prefix. For nested pages, resolve against the returned app base URL rather than
the current page, e.g. `fetch(new URL("api/count", appUrl))`. The same rule applies
to asset URLs, links, and redirects.

In the Worker, use exact app-relative checks such as
`new URL(request.url).pathname === "/api/count"`. Do not include `/<id>` or
loosen checks to `endsWith` to compensate for a misplaced browser request.
`/api/` is an app convention, not an automatically added or reserved prefix.

## Manifests

Static app:

```json
{
	"type": "static",
	"title": "Calculator",
	"description": "",
	"expiresAt": null
}
```

Worker with durable classes:

```json
{
	"type": "worker",
	"title": "Counter",
	"description": "",
	"entry": "worker.ts",
	"objects": ["Counter"],
	"vars": { "GREETING": "Hello" }
}
```

`entry` defaults to `worker.ts`; `objects` and `vars` default to empty collections.
`expiresAt` defaults to `null`, including for manifests created before TTL support.
Manifests are strictly parsed at the filesystem boundary. Unknown fields and
unsafe entry paths are rejected. Install any app dependencies in its own directory;
esbuild bundles local imports without running package scripts.

Worker environments receive two app-scoped Fetcher capabilities:
- `env.ASSETS.fetch(request)` reads this app's `public/` files directly from disk.
  GET and HEAD are supported; `/` and trailing-slash paths serve `index.html`.
- `env.OBJECTS.fetch(request)` routes `/ExportedClass/object-name/path` to a named
  durable facet. The facet sees `/path`. Object names use ASCII letters, digits,
  hyphens, or underscores, up to 128 characters. This is **not** a standard
  `DurableObjectNamespace`: there is no `get()`, `idFromName()`, or arbitrary RPC.

```typescript
import { DurableObject } from "cloudflare:workers";

export class Counter extends DurableObject {
	fetch(request) {
		if (request.method !== "GET" && request.method !== "POST")
			return new Response("Method not allowed", { status: 405 });
		let count = this.ctx.storage.kv.get("count") ?? 0;
		if (request.method === "POST") {
			count += 1;
			this.ctx.storage.kv.put("count", count);
		}
		return Response.json({ count });
	}
}

export default {
	fetch(request, env) {
		if (new URL(request.url).pathname === "/api/count") {
			return env.OBJECTS.fetch(
				new Request("https://objects/Counter/main/", request),
			);
		}
		return env.ASSETS.fetch(request);
	},
};
```

The `durable` template supplies this pattern with an `App` class and `/api/count`:
GET reads without mutation; POST increments. Its frontend demonstrates both.
The `worker` template demonstrates `./api/hello`. Templates are written only on
creation; existing app source is never rewritten by an extension update.

The `https://objects/Counter/main/` address is internal to `env.OBJECTS`: class
`Counter`, instance `main`, route `/`. It is not a browser URL or a real external
request, and the facet sees `/` rather than `/api/count`.

## Reloads and lifetime

Static files are read on each request. A recursive watcher debounces backend
changes, bundles with esbuild, and publishes a revision in memory. Compilation or
manifest errors are reported by `flare_get`/`flare_list`; the last successful
bundle continues serving. Fix the file and the next successful build replaces it.
Runtime exceptions are logged; successful bundling does not prove application
logic is correct. Restarting the manager rebuilds from disk, not a stored bundle.

Facet database identity is the app ID, class export, and object name—never the
code revision. Reloading aborts live facets and disposes old isolates, preserving
their databases; open facet WebSockets reconnect after a reload. Renaming an app,
class, or object changes its data identity. Deleting source retains durable data;
recreating the same directory ID and manifest can reuse it.

The runtime starts lazily on `/flare` or the first Flare tool call. Each Pi instance
that uses Flare renews a short-lived lease with one manager. Concurrent starts
race for its control port; only the winner starts celld. Closing one Pi does not
stop the others. About 1.5 seconds after the last session releases its lease,
the manager stops celld and its watcher. After an unexpected Pi exit, its lease
expires within 15 seconds. A new session can restart with persisted data intact.

### Automatic extension refresh

The manager hashes the built runtime's `.js` files once per second. Two
matching changed hashes trigger a syntax check, then a graceful runtime restart.
It waits for pending writes/builds and celld shutdown before handing off the
control port. Active session leases are transferred through a private temporary
file, so multiple Pi instances stay attached without competing restarts. App
source and durable databases are retained; the manager rebuilds apps from disk.
There can be a brief interruption to requests and live WebSocket connections.

Invalid extension syntax leaves the current runtime serving; `/health` reports
`reloadError` and `runtime.log` records the failure. Fixing the source retries
automatically. Tool calls compare the current source signature too and wait for
the new runtime instead of attaching to stale code. Unknown services or different
configurations are never stopped.

This refreshes the **shared manager, gateway, and directory page**. Pi's in-memory
tool definitions and guidance still require `/reload` when those change; runtime
refresh cannot replace extension code already loaded inside Pi. No compatibility
migration for version-numbered development managers is included.

## Configuration

Set these variables before starting Pi. Connected instances must use the same
settings; mismatches fail without killing an existing process.

| Variable                         | Default                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `PI_FLARE_HOME`                  | `~/.pi/flare`                                             |
| `PI_FLARE_HOST`                  | `127.0.0.1` (public listener's IPv4 or IPv6 bind address) |
| `PI_FLARE_PORT`                  | `53762`                                                   |
| `PI_FLARE_CONTROL_PORT`          | `53763`                                                   |
| `PI_FLARE_PUBLIC_URL`            | URL derived from the bind address and public port         |
| `PI_FLARE_BACKUP_INTERVAL_HOURS` | `12` (positive hours; fractions supported)                |
| `PI_FLARE_BACKUP_DIR`            | `~/.pi/flare-backups` (outside the live home)             |
| `PI_FLARE_CELLD`                 | `celld`                                                   |
| `CELLD_ESBUILD`                  | `esbuild`                                                 |

`PI_FLARE_HOST` controls the public celld listener; the private control listener
always stays on `127.0.0.1`. Wildcard addresses `0.0.0.0` and `::` advertise
loopback URLs by default (`127.0.0.1` and `[::1]`); set `PI_FLARE_PUBLIC_URL` to a
reachable address when opening apps from another machine:

```bash
PI_FLARE_HOST=0.0.0.0 PI_FLARE_PUBLIC_URL=http://192.168.1.50:53762 pi
```

Binding to a non-loopback address exposes the app directory and all apps to the
network **without browser authentication**. Use trusted networks or an
authenticated reverse proxy. `PI_FLARE_PUBLIC_URL` changes returned URLs only;
it does not create a proxy or change the bind address. Environment changes require
a fresh shared runtime; automatic source refresh preserves its launch environment.
For another independent Flare home, choose different public and control ports too.
Inspect `runtime.log`
for startup, Worker, build, backup, restore, and automatic refresh errors. Runtime source updates
refresh automatically while Flare is running; Markdown-only documentation changes
do not restart it.

## Boundaries

- This is a trusted, single-user local runtime—not a public multi-tenant host.
  Apps share a browser origin; use an authenticated reverse proxy and separate
  origins before exposing untrusted apps. Workers can make outbound requests.
- The manager authenticates every route with a private token. Only the gateway
  gets that token; loaded apps receive neither registry access nor a loader.
  Static paths are canonicalized to prevent symlink escapes.
- Facets have separate databases but share one parent Supervisor per app. They
  **cannot set alarms or hibernate WebSockets**, and are not independently placed
  across nodes. This implementation exposes HTTP fetch, not arbitrary facet RPC.
- celld limits the process to **256 live Dynamic Workers** (255 per generation).
  A backend app can occupy an entrypoint isolate and a Supervisor isolate.
  This is intended for a modest microapp collection, not 1,000 concurrent backends.
- Dynamic entrypoints use 50 ms CPU / 50 subrequest limits. celld's per-isolate
  heap limit is 128 MiB; these are not per-app aggregate resource quotas.
- Static hosting is deliberately minimal: no SPA fallback, `_headers`,
  `_redirects`, CDN caching, or automatic browser refresh. Reload the browser to
  see edited frontend files.

References: [Dynamic Workers](https://celld.dev/docs/services/dynamic-workers/),
[Durable Object Facets](https://celld.dev/docs/services/durable-object-facets/),
[local development](https://celld.dev/docs/#develop-an-application-locally).

## Development

This package lives in `extensions/flare` in the pi-mono Bun workspace. Install
dependencies from the monorepo root. The commands below run from this package
directory; shared tooling and configuration live at the root.

Bun manages dependencies, scripts, and tests. [Rslib](https://rslib.rs/) (Rspack)
compiles TypeScript into ESM under `dist/`, preserving runtime modules and copying
the celld gateway unchanged. Pi loads only `dist/index.js`; host-provided Pi and
TypeBox packages remain external peer dependencies. Biome is the only linter and
formatter.

```bash
bun run check       # Biome, TypeScript, and unit tests
bun run build       # production ESM build with Rslib
bun run dev         # Rslib watch mode
bun run smoke       # compiled-runtime integration checks; requires celld + esbuild
bun pm pack --dry-run
```

The smoke check uses a temporary home, temporary ports, and a copy of the compiled
package. It exercises all three templates, CRUD, durable state, and automatic
runtime refresh without changing your apps or build output.

After editing `src/`, rebuild (or keep `bun run dev` running). The manager watches
built files, not TypeScript source. Changes to tool definitions still need Pi's
`/reload`.

### Release

Keep the source version at `0.0.0`. From the monorepo root, use
`just version-set` to derive a version from `v*` Git tags, build and pack or publish,
then run `just version-reset`. See the [root release workflow](../../README.md#independent-releases)
for the two recipes and failure-safe reset example.

An exact `v1.2.3` tag becomes `1.2.3`; four commits later the version is
`1.2.3-post.4+<hash>`. Pack or publish before resetting so the artifact retains
its release version. Authenticate to npm for the `@karlis-vagalis` scope before
running `bun publish --access public` from this package directory.

The `prepack` hook runs checks and a fresh Rslib build for packing/publishing.
Only `dist/`, this readme, the MIT license, and npm's mandatory package metadata
are shipped. No automatic publishing workflow is configured.

## License

[MIT](LICENSE) © 2026 Kārlis Vagalis.
