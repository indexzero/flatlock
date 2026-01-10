#!/usr/bin/env bash
#
# Verify flatlock against Vue 3 monorepo (pnpm)
#
# This script validates that flatlock's pnpm parser correctly extracts
# dependencies from a workspace in a monorepo by comparing against a fresh
# install of the published package.
#
# The verification strategy:
#   1. Clone Vue 3 monorepo at a release tag
#   2. Extract dependencies from workspace using flatlock-deps
#   3. Create "husk" - fresh pnpm install of published package
#   4. Extract dependencies from husk
#   5. Compare: husk deps should be SUBSET of monorepo deps
#
# Artifacts are preserved in ./artifacts/pnpm-vue/ for inspection
#
# Usage:
#   ./pnpm-vue.sh [workspace_path]
#   VUE_TAG=v3.5.12 ./pnpm-vue.sh packages/shared
#
# Environment variables:
#   VUE_TAG         - Git tag to clone (default: v3.5.13)
#   PNPM_VERSION    - pnpm major version for npx (default: 9, requires 8.6+ for SBOM)
#
set -eo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/artifacts/pnpm-vue"
WORKSPACE_PATH="${1:-packages/compiler-sfc}"

# Version configuration - parameterized per review feedback
VUE_TAG="${VUE_TAG:-v3.5.13}"
PNPM_VERSION="${PNPM_VERSION:-9}"
# Note: SBOM validation is now MANDATORY (not opt-in) per security review

# ==============================================================================
# Utility Functions
# ==============================================================================

log() {
  echo "[pnpm-vue] $*"
}

die() {
  echo "[pnpm-vue] FATAL: $*" >&2
  exit 1
}

# Retry wrapper for network operations
# Attempts command up to 3 times with 5 second delay between attempts
retry() {
  local max_attempts=3
  local delay=5
  local attempt=1

  while true; do
    if "$@"; then
      return 0
    fi

    if [ $attempt -ge $max_attempts ]; then
      log "Command failed after $max_attempts attempts"
      return 1
    fi

    log "Attempt $attempt/$max_attempts failed, retrying in ${delay}s..."
    sleep $delay
    attempt=$((attempt + 1))
  done
}

# Platform filter - removes OS-specific packages that vary between environments
#
# These packages are platform-specific binaries that differ based on where
# the lockfile was generated vs where verification runs. Filtering them
# prevents false failures from platform mismatches.
#
# Uses single grep with alternation and || true to prevent exit 1 when
# all lines are filtered (which would kill the script with set -e).
platform_filter() {
  grep -Ev '^(@esbuild/|esbuild(@|$)|@swc/|@rollup/rollup-|fsevents(@|$)|@next/swc-)' || true
}

# ==============================================================================
# Environment Isolation
# ==============================================================================

# Clear potentially interfering environment variables that could cause
# installs to fail for wrong reasons or use unexpected registries
unset NPM_CONFIG_REGISTRY NPM_CONFIG_USERCONFIG 2>/dev/null || true
unset PNPM_HOME PNPM_STORE_DIR 2>/dev/null || true

# Warn if custom registry was configured
if [ -n "${npm_config_registry:-}" ]; then
  log "WARNING: Custom registry configured in environment: $npm_config_registry"
fi

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

log "Starting verification: Vue 3 ($VUE_TAG) workspace '$WORKSPACE_PATH'"
log ""

# Check required tools
for cmd in jq git npm; do
  if ! command -v "$cmd" >/dev/null; then
    die "$cmd is required but not installed"
  fi
done

if ! command -v flatlock-deps >/dev/null; then
  die "flatlock-deps is required but not installed (run: npm link in project root)"
fi

# Check pnpm version (v8+ required for modern lockfile support)
if ! command -v pnpm >/dev/null; then
  log "pnpm not found globally, will use npx pnpm@$PNPM_VERSION"
else
  PNPM_INSTALLED=$(pnpm --version | cut -d. -f1)
  if [ "$PNPM_INSTALLED" -lt 8 ]; then
    log "WARNING: pnpm $PNPM_INSTALLED installed, but v8+ recommended"
  else
    log "Found pnpm $(pnpm --version)"
  fi
fi

# ==============================================================================
# Setup
# ==============================================================================

log "Cleaning artifacts directory..."
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

# Create isolated home directory to avoid reading user's .npmrc
export ORIGINAL_HOME="$HOME"
export HOME="$ARTIFACTS/.home"
mkdir -p "$HOME"

# ==============================================================================
# Signal Handling
# ==============================================================================

VERIFICATION_COMPLETED=false

cleanup() {
  local exit_code=$?
  if [ "$VERIFICATION_COMPLETED" = "true" ]; then
    # Success - restore home, preserve artifacts for inspection
    export HOME="$ORIGINAL_HOME"
  else
    # Interrupted or failed - log and preserve partial artifacts for debugging
    if [ $exit_code -ne 0 ]; then
      log "Verification interrupted (exit $exit_code). Artifacts preserved in: $ARTIFACTS"
    fi
    export HOME="$ORIGINAL_HOME"
  fi
}
trap cleanup EXIT INT TERM

# ==============================================================================
# Step 1: Clone Vue 3 Monorepo
# ==============================================================================

log "Cloning vuejs/core at tag $VUE_TAG..."

if ! {
  retry git clone --depth 1 --branch "$VUE_TAG" \
    https://github.com/vuejs/core.git "$ARTIFACTS/monorepo" 2>&1
} | tee "$ARTIFACTS/clone.log"; then
  die "Clone failed after retries (see $ARTIFACTS/clone.log)"
fi

# Verify clone produced expected files
if [ ! -f "$ARTIFACTS/monorepo/pnpm-lock.yaml" ]; then
  log "Clone completed but pnpm-lock.yaml missing"
  log "Contents of monorepo directory:"
  ls -la "$ARTIFACTS/monorepo" 2>&1 || true
  die "Repository missing pnpm-lock.yaml - is this the right tag?"
fi

log "Clone successful"

# ==============================================================================
# Step 2: Extract Package Info
# ==============================================================================

WORKSPACE_PKG_JSON="$ARTIFACTS/monorepo/$WORKSPACE_PATH/package.json"
if [ ! -f "$WORKSPACE_PKG_JSON" ]; then
  log "Available workspaces:"
  ls -d "$ARTIFACTS/monorepo/packages"/*/ 2>/dev/null | xargs -I{} basename {} || true
  die "Workspace not found: $WORKSPACE_PATH"
fi

PKG_NAME=$(jq -r .name "$WORKSPACE_PKG_JSON")
PKG_VERSION=$(jq -r .version "$WORKSPACE_PKG_JSON")

if [ -z "$PKG_NAME" ] || [ "$PKG_NAME" = "null" ]; then
  die "Could not extract package name from $WORKSPACE_PKG_JSON"
fi
if [ -z "$PKG_VERSION" ] || [ "$PKG_VERSION" = "null" ]; then
  die "Could not extract package version from $WORKSPACE_PKG_JSON"
fi

echo "$PKG_NAME@$PKG_VERSION" > "$ARTIFACTS/package.txt"
log "Testing: $PKG_NAME@$PKG_VERSION"

# Verify package exists on npm before proceeding
log "Verifying $PKG_NAME@$PKG_VERSION exists on npm..."
if ! npm view "$PKG_NAME@$PKG_VERSION" version >/dev/null 2>&1; then
  log ""
  log "Package not found on npm. This can happen if:"
  log "  - The tag was created but npm publish hasn't happened yet"
  log "  - The version in package.json doesn't match the tag"
  log ""
  log "Tag version in repo: $PKG_VERSION"
  log "Latest on npm: $(npm view "$PKG_NAME" version 2>/dev/null || echo 'unknown')"
  die "$PKG_NAME@$PKG_VERSION not found on npm registry"
fi
log "Package verified on npm"

# ==============================================================================
# Step 3: Extract Dependencies from Monorepo
# ==============================================================================

log "Extracting dependencies from monorepo lockfile..."

if ! flatlock-deps "$ARTIFACTS/monorepo/pnpm-lock.yaml" -w "$WORKSPACE_PATH" \
  | platform_filter \
  | sort -u > "$ARTIFACTS/monorepo.flatlock.txt"; then
  die "flatlock-deps failed on monorepo lockfile"
fi

MONOREPO_COUNT=$(wc -l < "$ARTIFACTS/monorepo.flatlock.txt" | tr -d ' ')
log "Monorepo extraction: $MONOREPO_COUNT packages"

if [ "$MONOREPO_COUNT" -eq 0 ]; then
  log "WARNING: Monorepo extraction returned 0 packages"
  log "This may indicate a parsing issue or empty workspace dependencies"
fi

# ==============================================================================
# Step 4: Create Husk (Fresh Install of Published Package)
# ==============================================================================

log "Creating husk directory..."

mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"

# Create minimal package.json using jq to prevent JSON injection
# (PKG_NAME/PKG_VERSION could contain quotes or special characters)
jq -n \
  --arg name "$PKG_NAME" \
  --arg version "$PKG_VERSION" \
  '{name: "flatlock-verification-husk", private: true, dependencies: {($name): $version}}' \
  > package.json

# Disable postinstall scripts for security and reproducibility
echo "ignore-scripts=true" > .npmrc

log "Installing $PKG_NAME@$PKG_VERSION via pnpm..."

if ! {
  retry npx pnpm@"$PNPM_VERSION" install 2>&1
} | tee "$ARTIFACTS/husk-install.log"; then
  die "pnpm install failed after retries (see $ARTIFACTS/husk-install.log)"
fi

# Verify install produced lockfile
if [ ! -f "$ARTIFACTS/husk/pnpm-lock.yaml" ]; then
  log "pnpm install completed but pnpm-lock.yaml not created"
  log "Husk directory contents:"
  ls -la "$ARTIFACTS/husk" 2>&1 || true
  die "pnpm install did not create lockfile"
fi

log "Husk install successful"

# ==============================================================================
# Step 5: Extract Dependencies from Husk
# ==============================================================================

log "Extracting dependencies from husk lockfile..."

# Escape regex special characters in PKG_NAME for safe use in grep pattern
# Package names can contain . which is a regex metacharacter
PKG_NAME_ESCAPED=$(printf '%s\n' "$PKG_NAME" | sed 's/[[\.*^$()+?{|\\]/\\&/g')

# Exclude the package itself from the husk extraction
# Handle both "pkg" and "pkg@version" output formats
if ! flatlock-deps "$ARTIFACTS/husk/pnpm-lock.yaml" \
  | grep -Ev "^${PKG_NAME_ESCAPED}(@|$)" \
  | platform_filter \
  | sort -u > "$ARTIFACTS/husk.flatlock.txt"; then
  die "flatlock-deps failed on husk lockfile"
fi

HUSK_COUNT=$(wc -l < "$ARTIFACTS/husk.flatlock.txt" | tr -d ' ')
log "Husk extraction: $HUSK_COUNT packages"

# Empty husk is ALWAYS a failure - the package has real dependencies
if [ "$HUSK_COUNT" -eq 0 ]; then
  log ""
  log "Husk extraction returned 0 packages. Debug info:"
  log "  Lockfile exists: yes (checked above)"
  log "  Lockfile size: $(wc -c < "$ARTIFACTS/husk/pnpm-lock.yaml") bytes"
  log ""
  log "Raw flatlock output (first 20 lines):"
  flatlock-deps "$ARTIFACTS/husk/pnpm-lock.yaml" 2>&1 | head -20 || true
  die "Husk extraction returned 0 packages - extraction failed"
fi

# ==============================================================================
# Step 6: Compare Results
# ==============================================================================

cd "$SCRIPT_DIR"

log "Comparing monorepo vs husk extractions..."

# Generate comparison artifacts
# comm -23: lines only in first file (husk) = MISSING from monorepo
# comm -13: lines only in second file (monorepo) = EXTRA in monorepo
comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/missing.txt"
comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/extra.txt"

MISSING=$(wc -l < "$ARTIFACTS/missing.txt" | tr -d ' ')
EXTRA=$(wc -l < "$ARTIFACTS/extra.txt" | tr -d ' ')

# Sanity check on extras ratio
# If extras are >200% of husk count, something may be wrong with traversal
if [ "$HUSK_COUNT" -gt 0 ] && [ "$EXTRA" -gt 0 ]; then
  EXTRA_RATIO=$((EXTRA * 100 / HUSK_COUNT))
  if [ "$EXTRA_RATIO" -gt 200 ]; then
    log "WARNING: Extras are ${EXTRA_RATIO}% of husk count"
    log "This may indicate traversal is including unrelated workspace packages"
  fi
fi

# ==============================================================================
# Step 7: SBOM Ground Truth Validation (MANDATORY)
# ==============================================================================
#
# pnpm sbom provides independent ground truth - this is what pnpm's own tooling
# says is ACTUALLY installed. This validates flatlock against reality, not just
# against itself (which would pass even if both extractions had the same bug).
#

log "Generating SBOM for ground truth validation..."
cd "$ARTIFACTS/husk"

# Verify pnpm sbom is available (pnpm 8.6+ required)
if ! npx pnpm@"$PNPM_VERSION" sbom --help >/dev/null 2>&1; then
  die "pnpm sbom not available in pnpm@$PNPM_VERSION (requires 8.6+). Ground truth validation requires SBOM support."
fi

# Generate SBOM - this is mandatory, failure is fatal
if ! npx pnpm@"$PNPM_VERSION" sbom --output-format cyclonedx-json > "$ARTIFACTS/husk.sbom.json" 2>&1; then
  log "SBOM generation failed. Output:"
  cat "$ARTIFACTS/husk.sbom.json" 2>/dev/null || true
  die "pnpm sbom failed - cannot validate against ground truth"
fi

# Extract package list from SBOM
if ! jq -r '.components[] | select(.type=="library") | .name + "@" + .version' \
  "$ARTIFACTS/husk.sbom.json" \
  | platform_filter \
  | sort -u > "$ARTIFACTS/husk.sbom.txt"; then
  die "Failed to parse SBOM JSON"
fi

SBOM_COUNT=$(wc -l < "$ARTIFACTS/husk.sbom.txt" | tr -d ' ')
log "SBOM ground truth: $SBOM_COUNT packages"

if [ "$SBOM_COUNT" -eq 0 ]; then
  die "SBOM returned 0 packages - validation cannot proceed"
fi

# Validation 1: Compare husk flatlock vs SBOM (parser correctness on simple case)
log "Validating flatlock parser against SBOM ground truth..."
comm -23 "$ARTIFACTS/husk.sbom.txt" "$ARTIFACTS/husk.flatlock.txt" > "$ARTIFACTS/sbom-missing-from-flatlock.txt"
comm -13 "$ARTIFACTS/husk.sbom.txt" "$ARTIFACTS/husk.flatlock.txt" > "$ARTIFACTS/flatlock-extra-vs-sbom.txt"

SBOM_MISSING=$(wc -l < "$ARTIFACTS/sbom-missing-from-flatlock.txt" | tr -d ' ')
SBOM_EXTRA=$(wc -l < "$ARTIFACTS/flatlock-extra-vs-sbom.txt" | tr -d ' ')

if [ "$SBOM_MISSING" -gt 0 ]; then
  log "WARNING: flatlock missed $SBOM_MISSING packages that SBOM found"
  log "  (see $ARTIFACTS/sbom-missing-from-flatlock.txt)"
fi

# Validation 2: SBOM packages should be SUBSET of monorepo extraction
log "Validating monorepo extraction against SBOM ground truth..."
comm -23 "$ARTIFACTS/husk.sbom.txt" "$ARTIFACTS/monorepo.flatlock.txt" > "$ARTIFACTS/sbom-missing-from-monorepo.txt"
MONOREPO_MISSING_SBOM=$(wc -l < "$ARTIFACTS/sbom-missing-from-monorepo.txt" | tr -d ' ')

cd "$SCRIPT_DIR"

# ==============================================================================
# Step 8: Report Results
# ==============================================================================

echo ""
echo "=============================================================================="
echo "Verification Results: $PKG_NAME@$PKG_VERSION"
echo "=============================================================================="
echo ""
echo "Artifacts preserved in: $ARTIFACTS"
echo ""
ls -la "$ARTIFACTS"/*.txt 2>/dev/null || true
echo ""

# Determine overall pass/fail based on both comparisons
# 1. Original comparison: husk flatlock vs monorepo flatlock
# 2. SBOM validation: SBOM ground truth vs monorepo flatlock
OVERALL_PASS=true
FAILURE_REASONS=""

if [ "$MISSING" -gt 0 ]; then
  OVERALL_PASS=false
  FAILURE_REASONS="${FAILURE_REASONS}  - $MISSING packages in husk flatlock not found in monorepo\n"
fi

if [ "$MONOREPO_MISSING_SBOM" -gt 0 ]; then
  OVERALL_PASS=false
  FAILURE_REASONS="${FAILURE_REASONS}  - $MONOREPO_MISSING_SBOM packages from SBOM ground truth not found in monorepo\n"
fi

if [ "$SBOM_MISSING" -gt 0 ]; then
  # This is a warning, not failure - husk flatlock missed packages SBOM found
  # but if monorepo has them, we're still OK
  log "WARNING: Husk flatlock extraction missed $SBOM_MISSING packages vs SBOM"
fi

if [ "$OVERALL_PASS" = "true" ]; then
  log "PASS: Verification successful"
  log ""
  log "  Monorepo packages:     $MONOREPO_COUNT"
  log "  Husk flatlock:         $HUSK_COUNT"
  log "  SBOM ground truth:     $SBOM_COUNT"
  log "  Extra in monorepo:     $EXTRA (expected - workspace/dev deps)"
  log ""
  log "Validations passed:"
  log "  [OK] All husk flatlock deps found in monorepo extraction"
  log "  [OK] All SBOM ground truth deps found in monorepo extraction"
  log ""
  log "The 'extra' packages are expected - they include:"
  log "  - Other workspace packages in the monorepo"
  log "  - DevDependencies of the workspace"
  log "  - Transitive deps of workspace-only dependencies"

  VERIFICATION_COMPLETED=true
  exit 0
else
  log "FAIL: Verification failed"
  log ""
  log "  Monorepo packages:     $MONOREPO_COUNT"
  log "  Husk flatlock:         $HUSK_COUNT"
  log "  SBOM ground truth:     $SBOM_COUNT"
  log ""
  log "Failure reasons:"
  printf '%b' "$FAILURE_REASONS"

  if [ "$MISSING" -gt 0 ]; then
    echo ""
    echo "Missing packages (husk flatlock vs monorepo):"
    echo "----------------------------------------------"
    head -20 "$ARTIFACTS/missing.txt"
    if [ "$MISSING" -gt 20 ]; then
      echo "  ... and $((MISSING - 20)) more (see $ARTIFACTS/missing.txt)"
    fi
  fi

  if [ "$MONOREPO_MISSING_SBOM" -gt 0 ]; then
    echo ""
    echo "Missing packages (SBOM ground truth vs monorepo):"
    echo "--------------------------------------------------"
    head -20 "$ARTIFACTS/sbom-missing-from-monorepo.txt"
    if [ "$MONOREPO_MISSING_SBOM" -gt 20 ]; then
      echo "  ... and $((MONOREPO_MISSING_SBOM - 20)) more (see $ARTIFACTS/sbom-missing-from-monorepo.txt)"
    fi
  fi

  echo ""
  echo "This indicates flatlock-deps is not extracting all dependencies"
  echo "from the monorepo workspace. Check:"
  echo "  1. Workspace path resolution in pnpm parser"
  echo "  2. Transitive dependency traversal"
  echo "  3. Platform-specific package handling"
  echo "  4. Peer dependency variant handling"
  exit 1
fi
