#!/bin/bash
#
# Verify flatlock against npm/cli monorepo (workspaces/arborist)
#
# Artifacts are preserved in ./artifacts/npm-arborist/ for inspection
#
set -ex

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/artifacts/npm-arborist"
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

# Clone monorepo
git clone --depth 1 --branch latest https://github.com/npm/cli.git "$ARTIFACTS/monorepo" 2>/dev/null

PKG_NAME=$(jq -r .name "$ARTIFACTS/monorepo/workspaces/arborist/package.json")
PKG_VERSION=$(jq -r .version "$ARTIFACTS/monorepo/workspaces/arborist/package.json")
echo "$PKG_NAME@$PKG_VERSION" > "$ARTIFACTS/package.txt"

# Monorepo: flatlock extraction
flatlock-deps "$ARTIFACTS/monorepo/package-lock.json" -w workspaces/arborist | sort -u > "$ARTIFACTS/monorepo.flatlock.txt"

# Monorepo: CycloneDX extraction (for corroboration)
cd "$ARTIFACTS/monorepo"
npx -y @cyclonedx/cyclonedx-npm --output-format JSON --flatten-components --omit dev 2>/dev/null > "$ARTIFACTS/monorepo.cyclonedx.json" || true
jq -r '.components[] | select(.type=="library") | if (.group | length) > 0 then .group + "/" + .name else .name end' "$ARTIFACTS/monorepo.cyclonedx.json" 2>/dev/null | sort -u > "$ARTIFACTS/monorepo.cyclonedx.txt" || true

# Create husk (fresh install of published package)
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json
echo "ignore-scripts=true" > .npmrc
npm install --silent 2>/dev/null

# Husk: flatlock extraction (exclude the package itself)
flatlock-deps "$ARTIFACTS/husk/package-lock.json" | grep -v "^$PKG_NAME$" | sort -u > "$ARTIFACTS/husk.flatlock.txt"

# Husk: CycloneDX extraction (for corroboration)
npx -y @cyclonedx/cyclonedx-npm --output-format JSON --flatten-components --omit dev 2>/dev/null > "$ARTIFACTS/husk.cyclonedx.json" || true
jq -r '.components[] | select(.type=="library") | if (.group | length) > 0 then .group + "/" + .name else .name end | select(. != "'"$PKG_NAME"'")' "$ARTIFACTS/husk.cyclonedx.json" 2>/dev/null | sort -u > "$ARTIFACTS/husk.cyclonedx.txt" || true

# Compare: monorepo flatlock vs husk flatlock (primary verification)
MISSING=$(comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" | wc -l | tr -d ' ')
EXTRA=$(comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" | wc -l | tr -d ' ')

# Generate diff artifacts
comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/missing.txt"
comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/extra.txt"

# Corroboration: flatlock vs cyclonedx on husk
comm -3 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/husk.cyclonedx.txt" > "$ARTIFACTS/husk.diff.txt" 2>/dev/null || true

echo ""
echo "=== Artifacts preserved in: $ARTIFACTS ==="
echo ""
ls -la "$ARTIFACTS"/*.txt "$ARTIFACTS"/*.json 2>/dev/null | grep -v monorepo | grep -v husk || true
echo ""

if [ "$MISSING" -eq 0 ]; then
  echo "PASS: $PKG_NAME@$PKG_VERSION (extra: $EXTRA)"
  exit 0
else
  echo "FAIL: $MISSING missing, $EXTRA extra"
  echo "Missing packages:"
  cat "$ARTIFACTS/missing.txt" | head -10
  exit 1
fi
