# pi-mono

A Bun workspaces monorepo of independently published extensions for the
[pi coding agent](https://pi.dev/).

The root is private and is never published. Each directory under `extensions/`
is a separate npm package with its own manifest, runtime dependencies,
Pi entry point, and release lifecycle. Source versions stay at `0.0.0`; release
versions come from repository-wide `v*` Git tags.

## Packages

| Workspace          | npm package                | Documentation                       |
| ------------------ | -------------------------- | ----------------------------------- |
| `extensions/flare` | `@karlis-vagalis/pi-flare` | [Flare](extensions/flare/README.md) |

Only Flare has been extracted from pi-lib. Its `/flare` command, `flare_*` tools,
`PI_FLARE_*` variables, ports, existing app data, and backups are unchanged.

## Development

Use Bun 1.3.10+ and Node.js 22.12+:

```bash
bun install
bun run check       # Biome, then every workspace's typecheck and tests
bun run build       # build every workspace with Rslib / Rspack
bun run smoke       # integration checks; Flare requires celld + esbuild
bun run pack:check  # inspect every package's publishable files
```

A single `bun.lock` tracks the workspace. Biome is the only linter and formatter;
its configuration, TypeScript defaults, and development dependencies are shared
at the root. Runtime dependencies belong to the package that imports them.

To work on one extension:

```bash
bun run --filter @karlis-vagalis/pi-flare build
bun run --filter @karlis-vagalis/pi-flare dev
bun run --filter @karlis-vagalis/pi-flare test
```

After building, install the **package directory**, not the monorepo root:

```bash
pi install ./extensions/flare
```

See [Flare's readme](extensions/flare/README.md) for external requirements and
switching from the copy previously bundled in pi-lib.

## Independent releases

Packages are published separately, with versions derived from repository-wide
`v*` tags. Keep `0.0.0` in source control. The `justfile` has only two recipes:
- `just version-set`: strip `v` from the nearest reachable tag; transform
  `v1.2.3-4-gabc1234` into `1.2.3-post.4+abc1234`.
- `just version-reset`: restore every workspace version to the
  `placeholder_version` variable (`0.0.0`).

Both recipes synchronize `bun.lock`. Setting requires a reachable tag such as
`v1.2.3`; resetting does not require Git history. `-post` is valid SemVer but sorts
as a prerelease before its base release.

Build and pack **between** setting and resetting:

```bash
bun run check
just version-set
trap 'just version-reset' EXIT
bun run build
bun run --filter @karlis-vagalis/pi-flare smoke
(cd extensions/flare && bun pm pack --destination /tmp)
just version-reset
trap - EXIT
```

Pack or publish before resetting: the built JavaScript does not contain a separate
package manifest, but a packed tarball retains its stamped version. To publish
directly, run `bun publish --access public` from the package directory while its
version is set. Authenticate to npm for `@karlis-vagalis` first. The package's
`prepack` hook checks and rebuilds it; no automatic publishing workflow is
configured.

## Adding an extension

Create `extensions/<name>/` with:
- A `package.json` named `@karlis-vagalis/pi-<name>`, version `0.0.0`,
  `pi.extensions` entry, explicit publishable `files`, and public
  `publishConfig.access`.
- `src/`, an Rslib config, and a `tsconfig.json` extending
  `../../tsconfig.base.json`.
- `build`, `typecheck`, `test`, and `prepack` scripts, plus optional `dev`,
  `smoke`, and `pack:check` scripts.
- A readme and a copy of the MIT license for the npm tarball.

Add runtime dependencies inside that workspace with `bun add`; add shared
development tools from the root with `bun add --dev`. Declare host-provided Pi
packages and TypeBox as `"*"` peers rather than runtime dependencies. Run
`bun install` from the root to update the workspace lockfile.

## License

[MIT](LICENSE) © 2026 Kārlis Vagalis.
