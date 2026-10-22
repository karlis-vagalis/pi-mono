# pi-flare

Create and run local web apps from your [Pi](https://pi.dev/) session.

Flare gives Pi tools to create websites and small apps, then serves them through
a shared [celld](https://celld.dev/) runtime. Apps are ordinary files: you or the
agent can edit them, and the changes go live without a deployment step.

Use a static app for a page, a Worker for a backend, or a durable app when you
need saved state.

## Requirements

Install these before starting Pi:
- [Bun](https://bun.sh/) 1.3.10 or newer.
- [celld](https://celld.dev/), tested with 0.6.2.
- esbuild, tested with 0.28.2: `bun add --global esbuild`.

All three must be on `PATH`. Pi itself needs Node.js 22.12 or newer.

## Install

Install from the [pi-mono repository](https://github.com/karlis-vagalis/pi-mono):

```bash
pi install git:github.com/karlis-vagalis/pi-mono
```

To install only Flare from npm, once it has been published:

```bash
pi install npm:@karlis-vagalis/pi-flare
```

Use one installation method, not both. Run `/reload` in an existing Pi session
after installing.

## Use it

Run `/flare` to start the runtime and see your apps. You can then ask Pi to build
something:

> Create a small counter app with Flare. Save the count so it survives restarts.

Open [127.0.0.1:53762](http://127.0.0.1:53762/) to browse your apps. Source files
live under `~/.pi/flare/<app-id>/`. Static file edits are served immediately;
backend edits trigger a rebuild. Reload the browser to see frontend changes.

Pi gets five tools:

| Tool           | What it does                                       |
| -------------- | -------------------------------------------------- |
| `flare_create` | Create a static, Worker, or durable app            |
| `flare_list`   | List apps and build status                         |
| `flare_get`    | Find an app's directory, URLs, and any build error |
| `flare_update` | Change its title, description, or expiry           |
| `flare_delete` | Remove its source files, keeping durable data      |

Apps stay until you delete them unless you set a lifetime with `ttl_seconds`.
The runtime stops when the last Pi session using it closes; app files and saved
state remain on disk.

## Backups and settings

Flare backs up app files and durable data every 12 hours while it is running.
Backups go to `~/.pi/flare-backups` and are not pruned automatically.
- `/flare backup` makes a backup now.
- `/flare restore <backup>` restores all apps and durable data, after saving a
  recovery backup of the current state.

Set `PI_FLARE_HOME` to change the app directory, or `PI_FLARE_BACKUP_DIR` to change
the backup location. See the [reference](docs/runtime.md) for all settings,
routing examples, backup details, and runtime limits.

## Local use

Flare is for apps you trust, running on your own machine. Apps share a browser
origin and have no browser login. Keep the default loopback address unless you
understand the exposure; use an authenticated proxy before making apps reachable
from another machine.

## Development

Flare is part of the [pi-mono workspace](https://github.com/karlis-vagalis/pi-mono).
From the repository root:

```bash
bun install
bun run --filter @karlis-vagalis/pi-flare check
bun run --filter @karlis-vagalis/pi-flare build
bun run --filter @karlis-vagalis/pi-flare smoke
```

The smoke check requires celld and esbuild. It uses temporary apps and ports,
not your existing Flare data.

Releases use the same version as the other extensions in this repository.
Maintainers can publish all packages locally with `just publish` from the root,
or push a `v*` tag to use the GitHub workflow.

## License

[MIT](LICENSE)
