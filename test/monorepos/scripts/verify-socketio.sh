#!/bin/bash
# Verify socketio/socket.io - packages/socket.io
# Manual verification script - no bullshit
set -e

WORKSPACE="packages/socket.io"
REPO="socketio/socket.io"
BRANCH="main"

echo "=== Verifying $REPO workspace $WORKSPACE ==="

# 1. Clone
TMPDIR=$(mktemp -d)
echo "Cloning to $TMPDIR..."
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$TMPDIR"

cd "$TMPDIR"

# 2. Security config
echo "ignore-scripts=true" > .npmrc
echo "audit=false" >> .npmrc
echo "fund=false" >> .npmrc

# 3. Install
echo "Running npm install..."
npm install

# 4. CycloneDX
echo "Running CycloneDX..."
npx @cyclonedx/cyclonedx-npm \
  -w "$WORKSPACE" \
  --output-format JSON \
  --flatten-components \
  --omit dev > cyclonedx.json

# 5. Extract CycloneDX packages
echo "CycloneDX packages:"
node -e "
const sbom = require('./cyclonedx.json');
const pkg = require('./$WORKSPACE/package.json');
const selfKey = pkg.name + '@' + pkg.version;
const packages = new Set();
for (const c of sbom.components || []) {
  if (c.type === 'library' && c.name && c.version) {
    const name = c.group ? c.group + '/' + c.name : c.name;
    const key = name + '@' + c.version;
    if (key !== selfKey) packages.add(key);
  }
}
console.log('Count:', packages.size);
[...packages].sort().forEach(p => console.log('  ' + p));
"

# 6. Flatlock
echo ""
echo "Flatlock packages:"
node --input-type=module -e "
import { FlatlockSet } from '$PWD/../../../src/set.js';
import { readFileSync } from 'fs';

const lockfile = await FlatlockSet.fromPath('./package-lock.json');
const pkg = JSON.parse(readFileSync('./$WORKSPACE/package.json', 'utf8'));
const deps = await lockfile.dependenciesOf(pkg, { workspacePath: '$WORKSPACE', repoDir: '.', dev: false });
console.log('Count:', deps.size);
[...deps].map(d => d.name + '@' + d.version).sort().forEach(p => console.log('  ' + p));
"

# Cleanup
cd /
rm -rf "$TMPDIR"
echo "=== Done ==="
