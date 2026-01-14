#!/bin/bash
# Verify any monorepo workspace against CycloneDX
# Usage: ./verify-workspace.sh <repo> <branch> <workspace> <package-manager>
# Example: ./verify-workspace.sh socketio/socket.io main packages/socket.io npm
set -e

REPO="$1"
BRANCH="$2"
WORKSPACE="$3"
PM="${4:-npm}"

if [ -z "$REPO" ] || [ -z "$BRANCH" ] || [ -z "$WORKSPACE" ]; then
  echo "Usage: $0 <repo> <branch> <workspace> [package-manager]"
  echo "Example: $0 socketio/socket.io main packages/socket.io npm"
  exit 1
fi

FLATLOCK_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "=== Verifying $REPO@$BRANCH workspace $WORKSPACE ($PM) ==="

# 1. Clone
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
echo "1. Cloning to $TMPDIR..."
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$TMPDIR" 2>&1 | tail -1

cd "$TMPDIR"

# 2. Security config (ignore-scripts=true)
echo "2. Writing security config..."
echo "ignore-scripts=true" > .npmrc
echo "audit=false" >> .npmrc
echo "fund=false" >> .npmrc

if [ "$PM" = "pnpm" ]; then
  echo "ignore-scripts=true" > .pnpmrc
fi

if [ "$PM" = "yarn" ]; then
  echo "enableScripts: false" > .yarnrc.yml
  echo "enableTelemetry: false" >> .yarnrc.yml
fi

# 3. Install
echo "3. Running $PM install..."
$PM install 2>&1 | tail -3

# 4. CycloneDX
echo "4. Running CycloneDX..."
if [ "$PM" = "npm" ]; then
  npx @cyclonedx/cyclonedx-npm \
    -w "$WORKSPACE" \
    --output-format JSON \
    --flatten-components \
    --omit dev > cyclonedx.json 2>/dev/null
elif [ "$PM" = "pnpm" ]; then
  npx @cyclonedx/cyclonedx-pnpm \
    --packages "$WORKSPACE" \
    --output-format JSON \
    --flatten-components \
    --omit dev > cyclonedx.json 2>/dev/null
elif [ "$PM" = "yarn" ]; then
  # yarn uses cdxgen which supports all formats
  npx @cyclonedx/cdxgen \
    -o cyclonedx.json \
    --type yarn \
    "$WORKSPACE" 2>/dev/null
fi

# 5. Extract and compare
echo "5. Comparing outputs..."
node --input-type=module -e "
import { FlatlockSet } from '$FLATLOCK_DIR/src/set.js';
import { readFileSync } from 'fs';

// Get lockfile name
const lockfiles = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock'
};
const lockfileName = lockfiles['$PM'];

// CycloneDX
const sbom = JSON.parse(readFileSync('./cyclonedx.json', 'utf8'));
const pkg = JSON.parse(readFileSync('./$WORKSPACE/package.json', 'utf8'));
const selfKey = pkg.name + '@' + pkg.version;

const cdxSet = new Set();
for (const c of sbom.components || []) {
  if (c.type === 'library' && c.name && c.version) {
    const name = c.group ? c.group + '/' + c.name : c.name;
    const key = name + '@' + c.version;
    if (key !== selfKey) cdxSet.add(key);
  }
}

// Flatlock
const lockfile = await FlatlockSet.fromPath('./' + lockfileName);
const deps = await lockfile.dependenciesOf(pkg, { workspacePath: '$WORKSPACE', dev: false });
const flSet = new Set([...deps].map(d => d.name + '@' + d.version));

// Compare
const missing = [...cdxSet].filter(x => !flSet.has(x));
const extra = [...flSet].filter(x => !cdxSet.has(x));

console.log('');
console.log('=== RESULTS ===');
console.log('CycloneDX:', cdxSet.size, 'packages');
console.log('Flatlock: ', flSet.size, 'packages');
console.log('Missing:  ', missing.length);
console.log('Extra:    ', extra.length);

if (missing.length > 0) {
  console.log('');
  console.log('MISSING from flatlock:');
  missing.sort().forEach(p => console.log('  - ' + p));
}

if (extra.length > 0) {
  console.log('');
  console.log('EXTRA in flatlock:');
  extra.sort().forEach(p => console.log('  + ' + p));
}

console.log('');
if (missing.length === 0) {
  console.log('✓ PASS: flatlock >= cyclonedx');
  process.exit(0);
} else {
  console.log('✗ FAIL: flatlock missing packages');
  process.exit(1);
}
"
