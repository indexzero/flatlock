#!/bin/bash
# Verify flatlock finds the same PACKAGES (not versions) as ground truth
#
# Lockfiles pin versions. npm install gets latest. Compare NAMES only.
#
# Usage: ./verify-packages.sh <repo> <branch> <workspace> <package-manager>
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

echo "=== Package Name Verification ==="
echo "Repository: $REPO@$BRANCH"
echo "Workspace:  $WORKSPACE"
echo ""

# 1. Clone source repo
SOURCE_DIR=$(mktemp -d)
trap "rm -rf $SOURCE_DIR $TRUTH_DIR" EXIT

echo "1. Cloning source repo..."
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1 | tail -1

# 2. Get package name and version
PKG_NAME=$(node -e "console.log(require('$SOURCE_DIR/$WORKSPACE/package.json').name)")
PKG_VERSION=$(node -e "console.log(require('$SOURCE_DIR/$WORKSPACE/package.json').version)")
echo "   Package: $PKG_NAME@$PKG_VERSION"

# 3. Create ground truth
TRUTH_DIR=$(mktemp -d)
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

echo "ignore-scripts=true" > "$TRUTH_DIR/.npmrc"
echo "audit=false" >> "$TRUTH_DIR/.npmrc"

# 4. Install and get SBOM
echo "2. Installing $PKG_NAME@$PKG_VERSION..."
cd "$TRUTH_DIR"
npm install 2>&1 | tail -1

echo "3. Running CycloneDX..."
npx @cyclonedx/cyclonedx-npm \
  --output-format JSON \
  --flatten-components \
  --omit dev > cyclonedx.json 2>/dev/null

# 5. Find lockfile
LOCKFILES="package-lock.json pnpm-lock.yaml yarn.lock"
LOCKFILE=""
for lf in $LOCKFILES; do
  if [ -f "$SOURCE_DIR/$lf" ]; then
    LOCKFILE="$lf"
    break
  fi
done

echo "4. Comparing package NAMES (versions will differ)..."

node --input-type=module -e "
import { FlatlockSet } from '$FLATLOCK_DIR/src/set.js';
import { readFileSync } from 'fs';

// Ground truth: package NAMES only
const sbom = JSON.parse(readFileSync('$TRUTH_DIR/cyclonedx.json', 'utf8'));
const groundTruthNames = new Set();
for (const c of sbom.components || []) {
  if (c.type === 'library' && c.name) {
    const name = c.group ? c.group + '/' + c.name : c.name;
    groundTruthNames.add(name);
  }
}

// Flatlock: package NAMES only
const lockfile = await FlatlockSet.fromPath('$SOURCE_DIR/$LOCKFILE');
const pkg = JSON.parse(readFileSync('$SOURCE_DIR/$WORKSPACE/package.json', 'utf8'));
const deps = await lockfile.dependenciesOf(pkg, { workspacePath: '$WORKSPACE', repoDir: '$SOURCE_DIR', dev: false });
const flNames = new Set([...deps].map(d => d.name));

// Compare NAMES
const missingNames = [...groundTruthNames].filter(x => !flNames.has(x));
const extraNames = [...flNames].filter(x => !groundTruthNames.has(x));

console.log('');
console.log('=== RESULTS (package names only) ===');
console.log('Ground truth:', groundTruthNames.size, 'packages');
console.log('Flatlock:    ', flNames.size, 'packages');
console.log('Missing:     ', missingNames.length);
console.log('Extra:       ', extraNames.length);

if (missingNames.length > 0) {
  console.log('');
  console.log('MISSING package names:');
  missingNames.sort().slice(0, 20).forEach(p => console.log('  - ' + p));
  if (missingNames.length > 20) console.log('  ... and', missingNames.length - 20, 'more');
}

if (extraNames.length > 0) {
  console.log('');
  console.log('EXTRA package names:');
  extraNames.sort().slice(0, 20).forEach(p => console.log('  + ' + p));
  if (extraNames.length > 20) console.log('  ... and', extraNames.length - 20, 'more');
}

console.log('');
if (missingNames.length === 0) {
  console.log('✓ PASS: flatlock has all package names');
  process.exit(0);
} else {
  console.log('✗ FAIL: flatlock missing package names');
  process.exit(1);
}
"
