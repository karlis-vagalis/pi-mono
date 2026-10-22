set shell := ["bash", "-euo", "pipefail", "-c"]

placeholder_version := "0.0.0"

# Stamp workspace versions from v* tags: 1.2.3 or 1.2.3-post.4+abc1234.
version-set:
    version="$(git describe --tags --match 'v*' --abbrev=7 | sed -E 's/^v//; s/-([0-9]+)-g([0-9a-f]+)$/-post.\1+\2/')"; \
    for manifest in extensions/*/package.json; do \
        (cd "$(dirname "$manifest")" && bun pm pkg set "version=$version"); \
    done
    bun install --lockfile-only --ignore-scripts

# Check, stamp, build, pack, reset, then publish every public workspace with npm.
publish:
    #!/usr/bin/env bash
    set -euo pipefail
    bun run check
    packages="$(mktemp -d)"
    reset=true
    trap 'if $reset; then just version-reset; fi; rm -rf "$packages"' EXIT
    just version-set
    bun run build
    for manifest in extensions/*/package.json; do
        if bun -e 'process.exit((await Bun.file(process.argv[1]).json()).private === true ? 0 : 1)' "$manifest"; then
            continue
        fi
        (cd "$(dirname "$manifest")" && bun pm pack --ignore-scripts --destination "$packages")
    done
    just version-reset
    reset=false
    for tarball in "$packages"/*.tgz; do
        version="$(tar -xOf "$tarball" package/package.json | bun -e 'console.log((await Bun.stdin.json()).version)')"
        dist_tag=latest
        if [[ "$version" == *-* ]]; then
            dist_tag=next
        fi
        npm publish "$tarball" --access public --ignore-scripts --tag "$dist_tag"
    done

# Reset manifests and the workspace lockfile after building/packing.
version-reset:
    for manifest in extensions/*/package.json; do (cd "$(dirname "$manifest")" && bun pm pkg set "version={{ placeholder_version }}"); done
    bun install --lockfile-only --ignore-scripts
