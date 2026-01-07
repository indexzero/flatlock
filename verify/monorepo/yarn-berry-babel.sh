#!/bin/bash
#
# Verify flatlock against Babel monorepo (yarn berry)
#
set -ex

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/artifacts/yarn-berry-babel"
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

BABEL_TAG="${BABEL_TAG:-v7.26.10}"
WORKSPACE="${1:-packages/babel-parser}"

# Clone monorepo
git clone --depth 1 --branch "$BABEL_TAG" https://github.com/babel/babel.git "$ARTIFACTS/monorepo"

PKG_NAME=$(jq -r .name "$ARTIFACTS/monorepo/$WORKSPACE/package.json")
PKG_VERSION=$(jq -r .version "$ARTIFACTS/monorepo/$WORKSPACE/package.json")
echo "$PKG_NAME@$PKG_VERSION" > "$ARTIFACTS/package.txt"

# Extract workspace scope (e.g., @babel from @babel/parser)
PKG_SCOPE="${PKG_NAME%/*}"

# Platform filter - removes OS-specific packages
platform_filter() { grep -Ev '^(@esbuild/|@swc/|@rollup/rollup-|fsevents)' || true; }

# Workspace filter - removes internal workspace packages (expected to differ)
workspace_filter() { grep -Ev "^${PKG_SCOPE}/" || true; }

# Monorepo: flatlock extraction
flatlock-deps "$ARTIFACTS/monorepo/yarn.lock" -w "$WORKSPACE" | platform_filter | sort -u > "$ARTIFACTS/monorepo.flatlock.txt"

# Create husk (fresh install of published package)
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"

# Create empty yarn.lock first to mark this as a standalone project
# (required to avoid inheriting parent project's yarn.lock)
touch yarn.lock

# Create package.json without packageManager to avoid corepack requirement
cat > package.json << EOF
{
  "dependencies": { "$PKG_NAME": "$PKG_VERSION" }
}
EOF

# Configure yarn berry: use node_modules linker and set yarn version
cat > .yarnrc.yml << EOF
nodeLinker: node-modules
yarnPath: .yarn/releases/yarn-4.1.0.cjs
EOF

# Download yarn berry
mkdir -p .yarn/releases
curl -sL https://repo.yarnpkg.com/4.1.0/packages/yarnpkg-cli/bin/yarn.js -o .yarn/releases/yarn-4.1.0.cjs

# Install using yarn berry directly
node .yarn/releases/yarn-4.1.0.cjs install

# Verify yarn berry format (safety check)
# __metadata appears after header comments, typically on line 4
if ! grep -q "^__metadata:" yarn.lock; then
  echo "ERROR: Husk uses yarn classic instead of berry"
  exit 1
fi

# Husk: flatlock extraction (exclude root package and workspace packages)
flatlock-deps "$ARTIFACTS/husk/yarn.lock" | grep -v "^$PKG_NAME$" | workspace_filter | platform_filter | sort -u > "$ARTIFACTS/husk.flatlock.txt"

# Husk: SBOM ground truth (cdxgen - universal CycloneDX generator)
yarn dlx @cyclonedx/cdxgen --required-only -o "$ARTIFACTS/husk.sbom.json" 2>/dev/null || true
if [ -f "$ARTIFACTS/husk.sbom.json" ]; then
  jq -r '.components[] | select(.type=="library") | if (.group | length) > 0 then "\(.group)/\(.name)" else .name end' "$ARTIFACTS/husk.sbom.json" | grep -v "^$PKG_NAME$" | workspace_filter | platform_filter | sort -u > "$ARTIFACTS/husk.sbom.txt"
fi

# Compare
comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/missing.txt"
comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/extra.txt"

MISSING=$(wc -l < "$ARTIFACTS/missing.txt" | tr -d ' ')
EXTRA=$(wc -l < "$ARTIFACTS/extra.txt" | tr -d ' ')

# SBOM comparison (if available)
SBOM_MISSING=0
if [ -f "$ARTIFACTS/husk.sbom.txt" ]; then
  comm -23 "$ARTIFACTS/husk.sbom.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/sbom-missing.txt"
  SBOM_MISSING=$(wc -l < "$ARTIFACTS/sbom-missing.txt" | tr -d ' ')
fi

echo ""
echo "=== Artifacts: $ARTIFACTS ==="
ls -la "$ARTIFACTS"/*.txt 2>/dev/null || true
echo ""

if [ "$MISSING" -eq 0 ]; then
  echo "PASS: $PKG_NAME@$PKG_VERSION (extra: $EXTRA, sbom-missing: $SBOM_MISSING)"
  exit 0
else
  echo "FAIL: $MISSING missing, $EXTRA extra"
  [ "$MISSING" -gt 0 ] && head -10 "$ARTIFACTS/missing.txt"
  exit 1
fi
