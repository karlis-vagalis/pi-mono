# pi-flare

Small web apps and static artifacts, straight from your [Pi](https://pi.dev/) session.

Flare gives the agent a place to serve small apps, HTML pages, reports, and
previews, so it can hand you a URL to open in your browser.

It runs locally on [celld](https://celld.dev/), borrowing ideas from Cloudflare
Workers, Durable Objects, and Wrangler. Use static hosting for artifacts, a
Worker for backend code, or a durable app for saved state. Edit the files
directly; changes go live without a deployment step.

If needed, you can later adapt an app for Cloudflare or another host.

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

To install only Flare from npm:

```bash
pi install npm:@karlis-vagalis/pi-flare
```

Use one installation method, not both. Run `/reload` in an existing Pi session
after installing.

## Use it

Run `/flare` to start the runtime and see your apps. You can then ask Pi to build
something:

> Create a small counter app with Flare. Save the count so it survives restarts.

Or ask for a static artifact:

> Turn this analysis into an HTML report and host it with Flare so I can view it in my browser.

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
Closing Pi does not stop Flare: apps and artifacts keep serving, and file watching
and scheduled backups continue. Run `/flare stop` when you want to shut down the
shared runtime. It keeps your files and data; the next Flare command or tool call
starts it again.

## Backups and settings

Flare backs up app files and durable data every 12 hours while it is running.
Backups go to `~/.pi/flare-backups`. By default, all backups are kept. To keep only
the newest completed backup for each Flare home:

```bash
PI_FLARE_BACKUP_KEEP=1 pi
```

Older backups are pruned only after a new backup succeeds. The limit applies to
scheduled backups, manual backups, and restore recovery snapshots.
- `/flare backup` makes a backup now.
- `/flare restore <backup>` restores all apps and durable data, after saving a
  recovery backup of the current state.

### Environment variables

Set these before starting Pi. Sessions sharing a runtime must use the same settings.

| Variable                         | Default                    | What it changes                                                                                           |
| -------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PI_FLARE_HOME`                  | `~/.pi/flare`              | Where app files, durable data, and runtime files are stored.                                              |
| `PI_FLARE_HOST`                  | `127.0.0.1`                | IPv4 or IPv6 address the app server listens on.                                                           |
| `PI_FLARE_PORT`                  | `53762`                    | Port used to serve apps and the app directory.                                                            |
| `PI_FLARE_CONTROL_PORT`          | `53763`                    | Private manager port, always bound to `127.0.0.1`.                                                        |
| `PI_FLARE_PUBLIC_URL`            | Derived from host and port | Base URL returned by the tools, for example when using a reverse proxy. Does not change the bind address. |
| `PI_FLARE_BACKUP_DIR`            | `~/.pi/flare-backups`      | Where backups are saved. Must be outside the app home, including through symlinks.                        |
| `PI_FLARE_BACKUP_INTERVAL_HOURS` | `12`                       | Hours between scheduled backups. Must be positive; fractions such as `0.5` work.                          |
| `PI_FLARE_BACKUP_KEEP`           | `0` (unlimited)            | Number of completed backups to keep per Flare home. Set to `1` to keep only the latest.                   |
| `PI_FLARE_CELLD`                 | `celld`                    | Command or executable path used to start celld.                                                           |
| `CELLD_ESBUILD`                  | `esbuild`                  | Command or executable path used to bundle Worker code.                                                    |

The two ports must be different and between `1024` and `65535`. Run `/flare stop`
and close sessions using Flare before changing its environment, then start Pi again.
For a separate app home, choose separate public and control ports too.

See the [reference](docs/runtime.md) for routing examples, backup details, and
runtime limits.

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
```

Releases use the same version as the other extensions in this repository.
Maintainers can publish all packages locally with `just publish` from the root,
or push a `v*` tag to use the GitHub workflow.

## License

[MIT](LICENSE)
