#!/bin/bash
# Verify flatlock against ground truth: the published package
#
# The way: Install the published package fresh, run CycloneDX on that.
# Works for ANY package manager's monorepo.
#
# Usage: ./verify-published.sh <repo> <branch> <workspace> <package-manager>
set -e

REPO="$1"
BRANCH="$2"
WORKSPACE="$3"
PM="${4:-npm}"

if [ -z "$REPO" ] || [ -z "$BRANCH" ] || [ -z "$WORKSPACE" ]; then
  echo "Usage: $0 <repo> <branch> <workspace> [package-manager]"
  exit 1
fi

FLATLOCK_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "=== Ground Truth Verification ==="
echo "Repository: $REPO@$BRANCH"
echo "Workspace:  $WORKSPACE"
echo "PM:         $PM"
echo ""

# 1. Clone source repo to get lockfile and workspace package.json
SOURCE_DIR=$(mktemp -d)
trap "rm -rf $SOURCE_DIR $TRUTH_DIR" EXIT

echo "1. Cloning source repo..."
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1 | tail -1

# 2. Get package name and version from workspace
echo "2. Reading workspace package.json..."
PKG_NAME=$(node -e "console.log(require('$SOURCE_DIR/$WORKSPACE/package.json').name)")
PKG_VERSION=$(node -e "console.log(require('$SOURCE_DIR/$WORKSPACE/package.json').version)")
echo "   Package: $PKG_NAME@$PKG_VERSION"

# 3. Create ground truth directory
TRUTH_DIR=$(mktemp -d)
echo "3. Creating ground truth package..."

cat > "$TRUTH_DIR/package.json" << EOF
{
  "name": "ground-truth-test",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "$PKG_NAME": "$PKG_VERSION"
  }
}
EOF

# Security config
echo "ignore-scripts=true" > "$TRUTH_DIR/.npmrc"
echo "audit=false" >> "$TRUTH_DIR/.npmrc"
echo "fund=false" >> "$TRUTH_DIR/.npmrc"

# 4. Install ground truth
echo "4. Installing $PKG_NAME@$PKG_VERSION..."
cd "$TRUTH_DIR"
npm install 2>&1 | tail -3

# 5. Run CycloneDX on ground truth
echo "5. Running CycloneDX on ground truth..."
npx @cyclonedx/cyclonedx-npm \
  --output-format JSON \
  --flatten-components \
  --omit dev > cyclonedx.json 2>/dev/null

# 6. Get lockfile name and run flatlock on source
echo "6. Running flatlock on source lockfile..."

LOCKFILES="package-lock.json pnpm-lock.yaml yarn.lock"
LOCKFILE=""
for lf in $LOCKFILES; do
  if [ -f "$SOURCE_DIR/$lf" ]; then
    LOCKFILE="$lf"
    break
  fi
done

if [ -z "$LOCKFILE" ]; then
  echo "ERROR: No lockfile found in $SOURCE_DIR"
  exit 1
fi

echo "   Using lockfile: $LOCKFILE"

# 7. Compare
echo "7. Comparing..."
node --input-type=module -e "
import { FlatlockSet } from '$FLATLOCK_DIR/src/set.js';
import { readFileSync } from 'fs';

// Ground truth from CycloneDX
const sbom = JSON.parse(readFileSync('$TRUTH_DIR/cyclonedx.json', 'utf8'));
const groundTruth = new Set();
for (const c of sbom.components || []) {
  if (c.type === 'library' && c.name && c.version) {
    const name = c.group ? c.group + '/' + c.name : c.name;
    groundTruth.add(name + '@' + c.version);
  }
}

// Flatlock from source lockfile
const lockfile = await FlatlockSet.fromPath('$SOURCE_DIR/$LOCKFILE');
const pkg = JSON.parse(readFileSync('$SOURCE_DIR/$WORKSPACE/package.json', 'utf8'));
const deps = lockfile.dependenciesOf(pkg, { workspacePath: '$WORKSPACE', dev: false });
const flSet = new Set([...deps].map(d => d.name + '@' + d.version));

// Compare
const missing = [...groundTruth].filter(x => !flSet.has(x));
const extra = [...flSet].filter(x => !groundTruth.has(x));

console.log('');
console.log('=== RESULTS ===');
console.log('Ground truth:', groundTruth.size, 'packages');
console.log('Flatlock:    ', flSet.size, 'packages');
console.log('Missing:     ', missing.length);
console.log('Extra:       ', extra.length);

if (missing.length > 0) {
  console.log('');
  console.log('MISSING from flatlock:');
  missing.sort().slice(0, 20).forEach(p => console.log('  - ' + p));
  if (missing.length > 20) console.log('  ... and', missing.length - 20, 'more');
}

if (extra.length > 0) {
  console.log('');
  console.log('EXTRA in flatlock:');
  extra.sort().slice(0, 20).forEach(p => console.log('  + ' + p));
  if (extra.length > 20) console.log('  ... and', extra.length - 20, 'more');
}

console.log('');
if (missing.length === 0) {
  console.log('✓ PASS: flatlock >= ground truth');
  process.exit(0);
} else {
  console.log('✗ FAIL: flatlock missing packages');
  process.exit(1);
}
"
