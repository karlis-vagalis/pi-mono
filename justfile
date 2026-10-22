set shell := ["bash", "-euo", "pipefail", "-c"]

placeholder_version := "0.0.0"

# Stamp workspace versions from v* tags: 1.2.3 or 1.2.3-post.4+abc1234.
version-set:
    version="$(git describe --tags --match 'v*' --abbrev=7 | sed -E 's/^v//; s/-([0-9]+)-g([0-9a-f]+)$/-post.\1+\2/')"; \
    for manifest in extensions/*/package.json; do \
        (cd "$(dirname "$manifest")" && bun pm pkg set "version=$version"); \
    done
    bun install --lockfile-only --ignore-scripts

# Reset manifests and the workspace lockfile after building/packing.
version-reset:
    for manifest in extensions/*/package.json; do (cd "$(dirname "$manifest")" && bun pm pkg set "version={{ placeholder_version }}"); done
    bun install --lockfile-only --ignore-scripts
