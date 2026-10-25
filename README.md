# pi-mono

> **AI disclosure:** AI tools were used to assist with code and documentation in this repository. The maintainer reviews changes and is responsible for the project.

Extensions for the [Pi coding agent](https://pi.dev/). Install the collection
from GitHub, or choose individual packages from npm.

## Extensions

| Extension                           | What it adds                                                    | npm package                |
| ----------------------------------- | --------------------------------------------------------------- | -------------------------- |
| [Flare](extensions/flare/README.md) | Build small apps or share HTML pages and reports in the browser | `@karlis-vagalis/pi-flare` |

Flare is the first extension here. More can be added without changing how you
install the repository.

## Install

To install everything in this repository:

```bash
pi install git:github.com/karlis-vagalis/pi-mono
```

Pi loads the extension paths declared in the root `package.json`; a Git install
does not need a build step. Check each extension's README for any external
requirements.

Individual npm packages are available after their first release. For Flare:

```bash
pi install npm:@karlis-vagalis/pi-flare
```

Choose the repository or individual packages, not both, to avoid loading an
extension twice. Run `/reload` after installing into an existing Pi session.

## Work on the code

You'll need Bun 1.3.10+ and Node.js 22.12+.

```bash
git clone https://github.com/karlis-vagalis/pi-mono.git
cd pi-mono
bun install
bun run check
bun run build
```

To try your checkout in Pi:

```bash
pi install .
```

The repository uses Bun workspaces. Each extension lives under `extensions/`
and has its own npm package. Biome handles linting and formatting; Rslib builds
the JavaScript shipped to npm.

Some useful commands:

```bash
bun run format
bun run --filter @karlis-vagalis/pi-flare dev
bun run pack:check  # show what each npm package will contain
```

When adding an extension, give it a `src/index.ts` entry point, its own package
manifest and README, and a copy of the MIT license. Keep runtime dependencies
with the extension and shared development tools at the root.

## Releases

All extension packages are versioned together. Pushing a tag such as `v1.2.3`
makes GitHub Actions set every package to `1.2.3`, run checks, build, and publish
each package to npm. Ordinary commits and pull requests do not publish anything.

Package versions stay at `0.0.0` in the source tree. To publish locally with npm:

```bash
just publish
```

This checks the code, sets every extension's version from Git, builds and packs
them, resets the source versions, then publishes the tarballs. It uses your local
npm credentials. The `version-set` and `version-reset` recipes are also available
separately. Between tags, versions such as `1.2.3-post.4+abc1234` go to npm's
`next` tag rather than `latest`.

## License

[MIT](LICENSE)
