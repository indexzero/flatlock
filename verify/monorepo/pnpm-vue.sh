#!/bin/bash
#
# Verify flatlock against Vue 3 monorepo (pnpm)
#
set -ex

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/artifacts/pnpm-vue"
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

VUE_TAG="${VUE_TAG:-v3.5.13}"
WORKSPACE="${1:-packages/compiler-sfc}"

# Clone monorepo
git clone --depth 1 --branch "$VUE_TAG" https://github.com/vuejs/core.git "$ARTIFACTS/monorepo"

PKG_NAME=$(jq -r .name "$ARTIFACTS/monorepo/$WORKSPACE/package.json")
PKG_VERSION=$(jq -r .version "$ARTIFACTS/monorepo/$WORKSPACE/package.json")
echo "$PKG_NAME@$PKG_VERSION" > "$ARTIFACTS/package.txt"

# Extract workspace scope (e.g., @vue from @vue/compiler-sfc)
PKG_SCOPE="${PKG_NAME%/*}"

# Platform filter - removes OS-specific packages
platform_filter() { grep -Ev '^(@esbuild/|@swc/|@rollup/rollup-|fsevents)' || true; }

# Workspace filter - removes internal workspace packages (expected to differ)
workspace_filter() { grep -Ev "^${PKG_SCOPE}/" || true; }

# Monorepo: flatlock extraction
flatlock-deps "$ARTIFACTS/monorepo/pnpm-lock.yaml" -w "$WORKSPACE" | platform_filter | sort -u > "$ARTIFACTS/monorepo.flatlock.txt"

# Create husk (fresh install of published package)
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json
echo "ignore-scripts=true" > .npmrc
pnpm install --silent

# Husk: flatlock extraction (exclude root package and workspace packages)
flatlock-deps "$ARTIFACTS/husk/pnpm-lock.yaml" | grep -v "^$PKG_NAME$" | workspace_filter | platform_filter | sort -u > "$ARTIFACTS/husk.flatlock.txt"

# Husk: SBOM ground truth (cdxgen - universal CycloneDX generator)
pnpm dlx @cyclonedx/cdxgen --required-only -o "$ARTIFACTS/husk.sbom.json"
jq -r '.components[] | select(.type=="library") | if (.group | length) > 0 then "\(.group)/\(.name)" else .name end' "$ARTIFACTS/husk.sbom.json" | grep -v "^$PKG_NAME$" | workspace_filter | platform_filter | sort -u > "$ARTIFACTS/husk.sbom.txt"

# Compare
comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/missing.txt"
comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/extra.txt"
comm -23 "$ARTIFACTS/husk.sbom.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/sbom-missing.txt"

MISSING=$(wc -l < "$ARTIFACTS/missing.txt" | tr -d ' ')
EXTRA=$(wc -l < "$ARTIFACTS/extra.txt" | tr -d ' ')
SBOM_MISSING=$(wc -l < "$ARTIFACTS/sbom-missing.txt" | tr -d ' ')

echo ""
echo "=== Artifacts: $ARTIFACTS ==="
ls -la "$ARTIFACTS"/*.txt 2>/dev/null || true
echo ""

if [ "$MISSING" -eq 0 ] && [ "$SBOM_MISSING" -eq 0 ]; then
  echo "PASS: $PKG_NAME@$PKG_VERSION (extra: $EXTRA)"
  exit 0
else
  echo "FAIL: $MISSING missing, $SBOM_MISSING sbom-missing, $EXTRA extra"
  [ "$MISSING" -gt 0 ] && head -10 "$ARTIFACTS/missing.txt"
  exit 1
fi
