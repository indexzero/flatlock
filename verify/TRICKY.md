# Tricky Aspects of Verification Script Implementation

This document analyzes the challenges of implementing verification scripts for pnpm, yarn classic, and yarn berry lockfile parsers using the same reconciliation pattern as the existing `npm-arborist.sh` verification.

---

## 1. Understanding the Verification Pattern

The verification pattern compares two dependency extractions:

```
Monorepo Workspace -----> flatlock-deps ----> Package List A
                                                   |
                                              (should match)
                                                   |
Published Package Husk -> flatlock-deps ----> Package List B
```

**What this validates:** The `dependenciesOf()` method correctly traverses the dependency graph from a workspace, following all transitive dependencies and workspace links.

**Why it works:** If the published package on npm declares the same dependencies as in the monorepo, a fresh install of that package should produce the same dependency tree that our parser extracts from the monorepo lockfile.

---

## 2. pnpm Verification Challenges

### 2.1 Lockfile Format Evolution

pnpm has undergone significant lockfile format changes:

| Era | Version | Package Key Format | Peer Suffix | Notes |
|-----|---------|-------------------|-------------|-------|
| shrinkwrap | v3/v4 | `/name/version` | `/peer@ver` with `!` escape | Pre-2019 |
| v5.x | 5.0-5.4 | `/name/version` | `_peer@ver` with `+` escape | 2019-2022 |
| v6 | 6.0 | `/name@version` | `(peer@ver)` parentheses | 2023 |
| v9 | 9.0 | `name@version` | `(peer@ver)` in snapshots | 2024+ |

**Key Challenge:** The v9 format splits package data across two sections:
- `packages`: Metadata (resolution, integrity, engines, peerDependencies)
- `snapshots`: Dependency relationships (dependencies, optionalDependencies)

The current code handles this by checking `snapshots` first for traversal:
```javascript
const depsSource = this.#snapshots || this.#packages || {};
```

### 2.2 Workspace Resolution

pnpm stores workspace relationships in the `importers` section:

```yaml
importers:
  packages/shared:
    dependencies:
      '@vue/reactivity':
        specifier: workspace:*
        version: link:../reactivity
```

The `link:` protocol must be resolved relative to the importer path. The current implementation handles this:
```javascript
if (version.startsWith('link:')) {
  const resolvedPath = this.#resolveRelativePath(ws, linkedPath);
  workspaceQueue.push(resolvedPath);
}
```

**Strength:** pnpm's `importers` section means the current code works WITHOUT needing the `workspacePackages` parameter.

### 2.3 Verification Target Recommendation

**Recommended: Vue 3 (vuejs/core)**

- Repository: `https://github.com/vuejs/core`
- Package Manager: pnpm v9 (latest lockfile format)
- Target Workspaces:
  - `packages/shared` - Small, foundational, few dependencies
  - `packages/reactivity` - Medium complexity, good test
- Cross-workspace dependencies: Yes (uses `link:` protocol)
- Published to npm: Yes (`@vue/shared`, `@vue/reactivity`)

**Alternative: Vite (vitejs/vite)**
- Target: `packages/vite`
- Good for testing larger dependency trees

### 2.4 Husk Creation

```bash
# Create husk directory
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"

# Create package.json with published version
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json

# Install using pnpm
pnpm install --silent

# Extract dependencies
flatlock-deps pnpm-lock.yaml | grep -v "^$PKG_NAME$" | sort -u
```

**CycloneDX Corroboration:** Use cdxgen (universal SBOM generator):
```bash
pnpm dlx @cyclonedx/cdxgen --required-only -o sbom.json
```

> **Note:** There is no official CycloneDX tool for pnpm. The `cyclonedx-node-pnpm` repository has been inactive since October 2022. Use `cdxgen` as the universal solution.

### 2.5 Edge Cases

1. **Peer Dependency Variants (v9):**
   Same package with different peers appears multiple times in `snapshots`:
   ```yaml
   snapshots:
     ts-api-utils@1.2.1(typescript@4.9.5): { ... }
     ts-api-utils@1.2.1(typescript@5.3.3): { ... }
   ```
   The traversal follows the actual dependency tree, so only the relevant variant is included.

2. **Auto-installed Peers:**
   pnpm v8+ with `autoInstallPeers: true` automatically installs peer dependencies. The husk will have these, and so should the monorepo extraction.

3. **Optional Dependencies:**
   Platform-specific optional deps may differ between monorepo (resolved on one OS) and husk (installed on another OS).

---

## 3. Yarn Classic Verification Challenges

### 3.1 Critical Issue: Workspaces NOT in Lockfile

**This is the single biggest challenge for yarn classic verification.**

Unlike npm and pnpm, yarn classic does NOT store workspace package information in `yarn.lock`. The lockfile contains ONLY external package resolutions.

**What's missing:**
- No workspace package entries
- No workspace-to-workspace dependency relationships
- No workspace package versions

**Consequence for `dependenciesOf()`:**

```javascript
// Current code in #dependenciesOfYarnClassic
if (nameToWorkspace.has(name)) {
  dep = { name: wsPkg.name, version: wsPkg.version };
  entry = null;  // <-- Workspace packages have NO lockfile entry
}

if (entry) {  // <-- This is SKIPPED for workspace packages
  for (const transName of Object.keys(entry.dependencies || {})) {
    queue.push(transName);
  }
}
```

**Bug/Limitation:** When the code encounters a workspace dependency, it emits the workspace package but CANNOT traverse its transitive dependencies (because `entry` is null).

**Example scenario:**
- Workspace A depends on Workspace B
- Workspace B depends on external package X
- Expected output: {B, X}
- Actual output: {B} (X is missing!)

### 3.2 Required Code Enhancement

To fix this limitation, `workspacePackages` must include dependency information:

```javascript
// Extended workspacePackages structure
workspacePackages: {
  'packages/A': {
    name: '@org/a',
    version: '1.0.0',
    dependencies: { '@org/b': '*' }
  },
  'packages/B': {
    name: '@org/b',
    version: '1.0.0',
    dependencies: { 'external-pkg': '^2.0.0' }
  }
}
```

Then `#dependenciesOfYarnClassic` can traverse workspace package dependencies:
```javascript
if (nameToWorkspace.has(name)) {
  const wsPkg = nameToWorkspace.get(name);
  // Add workspace package's dependencies to queue
  for (const depName of Object.keys(wsPkg.dependencies || {})) {
    if (!visited.has(depName)) queue.push(depName);
  }
}
```

### 3.3 Finding a Verification Target

**Challenge:** Most major yarn classic monorepos have migrated to yarn berry or pnpm.

| Project | Status | Notes |
|---------|--------|-------|
| Jest | Migrated to yarn berry (v29+) | |
| Gatsby | Complex, partial migration | |
| Lerna | Now Nx-maintained, changed | |
| Create React App | Archived | |

**Options:**

1. **Use older commit:** Clone a project at a tag before migration
   ```bash
   git clone --branch v28.0.0 https://github.com/facebook/jest.git
   ```

2. **Create synthetic test monorepo:** Build a small monorepo specifically for testing

3. **Find smaller project:** Look for less prominent projects still using yarn classic

4. **Accept limitation:** Document that yarn classic workspace verification is incomplete without code enhancements

### 3.4 Husk Creation

```bash
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json
yarn install
flatlock-deps yarn.lock | grep -v "^$PKG_NAME$" | sort -u
```

**Note:** Yarn classic does NOT have a `--package-lock-only` equivalent. Full installation is required.

**CycloneDX Corroboration:** Use cdxgen (there is no official CycloneDX tool for yarn classic - the yarn-plugin-cyclonedx requires yarn >= 4.0.0):
```bash
npx @cyclonedx/cdxgen --required-only -o sbom.json
```

### 3.5 Edge Cases

1. **npm: Alias Protocol:**
   ```
   string-width-cjs@npm:string-width@^4.2.0:
     version "4.2.3"
   ```
   The alias name (`string-width-cjs`) differs from actual package (`string-width`). Parser uses actual package name.

2. **Multiple Version Ranges:**
   ```
   lodash@^4.0.0, lodash@^4.17.0, lodash@^4.17.21:
     version "4.17.21"
   ```
   Multiple ranges resolve to same version. Parser handles by taking first.

3. **workspace-nohoist:**
   Yarn classic supports `nohoist` to prevent hoisting. Affects where packages are found but not lockfile content.

---

## 4. Yarn Berry Verification Challenges

### 4.1 workspace: Protocol

Yarn berry explicitly marks workspace dependencies:

```yaml
"@babel/parser@workspace:packages/babel-parser":
  version: 0.0.0-use.local
  resolution: "@babel/parser@workspace:packages/babel-parser"
  dependencies:
    "@babel/types": "workspace:^"
```

Unlike yarn classic, workspace entries DO exist and DO contain dependencies. The `workspace:^` specifiers are resolved to actual versions in subsequent traversal.

### 4.2 Verification Target Recommendation

**Recommended: Babel (babel/babel)**

- Repository: `https://github.com/babel/babel`
- Package Manager: yarn berry
- Target Workspaces:
  - `packages/babel-core` - Core functionality
  - `packages/babel-parser` - Parser package
- Published to npm: Yes (`@babel/core`, `@babel/parser`)
- Uses: workspace: protocol, cross-package deps

**Alternative: TypeScript ESLint (typescript-eslint/typescript-eslint)**
- Multiple published packages
- Active maintenance

### 4.3 Husk Creation Complexity

**Challenge:** Must ensure husk uses yarn berry, not yarn classic.

```bash
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json

# Ensure yarn berry
yarn set version berry

# Or copy .yarnrc.yml from monorepo
cp "$ARTIFACTS/monorepo/.yarnrc.yml" .

yarn install
flatlock-deps yarn.lock | grep -v "^$PKG_NAME$" | sort -u
```

**Alternative using corepack:**
```bash
corepack enable
corepack prepare yarn@stable --activate
```

**CycloneDX Corroboration:** For yarn berry v4+, use the official yarn plugin:
```bash
yarn dlx -q @cyclonedx/yarn-plugin-cyclonedx --output-format JSON -o sbom.json
```
Or use cdxgen as a universal alternative:
```bash
yarn dlx @cyclonedx/cdxgen --required-only -o sbom.json
```

### 4.4 PnP vs node_modules

Yarn berry can run in two modes:
- **PnP (Plug'n'Play):** No node_modules, packages in `.yarn/cache/`
- **node_modules:** Traditional layout (nodeLinker: node-modules)

**Impact on verification:**
- Lockfile format is identical in both modes
- **@cyclonedx/yarn-plugin-cyclonedx** works with BOTH modes (reads lockfile directly)
- **cdxgen** also works with both modes
- Check monorepo's `.yarnrc.yml` for `nodeLinker` setting

### 4.5 Required CLI Enhancement

Like yarn classic, yarn berry requires the `workspacePackages` parameter for proper workspace resolution. Without it, falls back to hoisted resolution.

```javascript
// Current: falls back to hoisted
if (this.#type === Type.YARN_BERRY && workspacePackages) {
  return this.#dependenciesOfYarnBerry(seeds, packageJson, options);
}
// Falls through to hoisted resolution if no workspacePackages
```

### 4.6 Edge Cases

1. **Resolution Field is Canonical:**
   Keys may contain aliases, but `resolution` has the actual package:
   ```yaml
   "string-width-cjs@npm:string-width@^4.2.0":
     resolution: "string-width@npm:4.2.3"  # <-- Real name
   ```
   Parser uses `parseResolution()` to get real name.

2. **patch: Protocol:**
   ```yaml
   "pkg@patch:pkg@npm%3A1.0.0#./.yarn/patches/...":
   ```
   Complex key format for patched packages. Parser finds earliest protocol marker.

3. **Virtual Packages:**
   Yarn berry creates virtual packages for peer resolution. These should be resolved to their real packages.

---

## 5. Common Causes of Verification Mismatches

### 5.1 False Negatives (Tests fail when parser is correct)

| Cause | Description | Mitigation |
|-------|-------------|------------|
| Platform-specific deps | `@esbuild/linux-x64` vs `@esbuild/darwin-arm64` | Exclude platform packages |
| Version drift | Monorepo locked `sub@2.0.0`, husk gets `sub@2.1.0` | Compare names only, not versions |
| Peer auto-install | npm/pnpm auto-install peers, yarn classic doesn't | Use same package manager |
| Time-based resolution | Package published between monorepo lock and husk | Accept minor drift |
| Registry state | Package unpublished or deprecated | Rare, accept if happens |

### 5.2 False Positives (Tests pass when parser is wrong)

| Cause | Description | Mitigation |
|-------|-------------|------------|
| Empty sets | Both return empty, passes trivially | Assert non-empty results |
| Compensating errors | Missing in both = match | Use CycloneDX corroboration |
| Over-inclusion | Extra deps in both | Check "extra" count too |

---

## 6. CLI Limitations and Required Enhancements

### 6.1 Current Limitation

The `flatlock-deps` CLI does not pass `workspacePackages` to `dependenciesOf()`:

```javascript
// bin/flatlock-deps.js - current code
const deps = lockfile.dependenciesOf(workspacePkg, {
  workspacePath: values.workspace,
  dev: values.dev,
  peer: values.peer
  // Missing: workspacePackages
});
```

**Impact:**
- **pnpm:** Works (uses importers from lockfile)
- **yarn berry:** Falls back to hoisted resolution (incorrect for workspaces)
- **yarn classic:** Falls back to hoisted resolution (incorrect for workspaces)

### 6.2 Proposed Enhancement

Add `--discover-workspaces` flag:

```bash
flatlock-deps pnpm-lock.yaml -w packages/shared --discover-workspaces
```

Implementation:
1. Read root `package.json` for workspace patterns
2. Glob to find matching directories
3. Read each workspace's `package.json` for name, version, dependencies
4. Build `workspacePackages` map
5. Pass to `dependenciesOf()`

**For yarn classic**, the map must include dependencies:
```javascript
workspacePackages: {
  'packages/foo': {
    name: '@org/foo',
    version: '1.0.0',
    dependencies: { lodash: '^4.17.0' },
    devDependencies: { jest: '^29.0.0' }
  }
}
```

---

## 7. CycloneDX Support Matrix

> **Recommendation:** Use `@cyclonedx/cdxgen` as the universal solution across all package managers. It auto-detects lockfile format and produces consistent output.

| Package Manager | Official Tool | Status | Universal Alternative |
|-----------------|--------------|--------|----------------------|
| npm | @cyclonedx/cyclonedx-npm | Released, well-maintained | cdxgen |
| pnpm | @cyclonedx/cyclonedx-pnpm | **ABANDONED** (inactive since Oct 2022) | cdxgen |
| yarn classic (v1) | None | N/A | cdxgen |
| yarn berry (v4+) | @cyclonedx/yarn-plugin-cyclonedx | Released, works well | cdxgen |

### Commands

**Universal (all package managers):**
```bash
npx @cyclonedx/cdxgen --required-only -o sbom.json
# or with pnpm/yarn:
pnpm dlx @cyclonedx/cdxgen --required-only -o sbom.json
yarn dlx @cyclonedx/cdxgen --required-only -o sbom.json
```

**npm (official):**
```bash
npx @cyclonedx/cyclonedx-npm --output-format JSON -o sbom.json
```

**yarn berry v4+ (official plugin):**
```bash
yarn dlx -q @cyclonedx/yarn-plugin-cyclonedx --output-format JSON -o sbom.json
# or install as plugin:
yarn plugin import https://github.com/CycloneDX/cyclonedx-node-yarn/releases/latest/download/yarn-plugin-cyclonedx.cjs
yarn cyclonedx --output-format JSON -o sbom.json
```

### Requirements

- **cdxgen:** Node.js >= 20
- **cyclonedx-npm:** Node.js >= 18
- **yarn-plugin-cyclonedx:** yarn >= 4.0.0 (berry only, not classic)

---

## 8. Recommended Implementation Order

### Priority 1: pnpm

**Why first:**
- Current code works without `workspacePackages`
- Importers section provides workspace info
- Vue 3 is an excellent, available target
- Only needs script adaptation, no code changes

**Estimated effort:** Low (1-2 hours)

### Priority 2: yarn berry

**Why second:**
- Babel is available as target
- Workspace entries exist in lockfile
- Needs CLI enhancement for proper workspace resolution
- Husk creation has minor complexity

**Estimated effort:** Medium (4-6 hours including CLI enhancement)

### Priority 3: yarn classic

**Why last:**
- Hardest to find verification target
- Requires both CLI enhancement AND code fix
- Workspace-to-workspace traversal broken
- May need synthetic test monorepo

**Estimated effort:** High (8+ hours including code fixes)

---

## 9. Platform-Specific Package Exclusions

Add exclusions for packages that vary by platform:

```bash
# Exclude platform-specific packages from comparison
grep -v "^@esbuild/" |
grep -v "^@swc/" |
grep -v "^fsevents$" |
grep -v "^@rollup/rollup-" |
grep -v "^@next/swc-"
```

**Common platform-specific packages:**
- `@esbuild/*` - esbuild platform binaries
- `@swc/*` - SWC platform binaries
- `@rollup/rollup-*` - Rollup platform binaries
- `@next/swc-*` - Next.js SWC binaries
- `fsevents` - macOS-only file watcher

---

## 10. Summary of Tricky Aspects by Severity

### Critical (Blocks verification)

1. **Yarn classic workspace traversal bug** - Cannot traverse workspace-to-workspace transitive dependencies
2. **CLI missing workspacePackages** - Affects yarn classic and yarn berry workspace resolution

### High (Causes false negatives)

3. **Platform-specific optional deps** - Different packages on different OSes
4. **Peer dependency handling differences** - Auto-install vs manual

### Medium (Requires careful handling)

5. **pnpm v9 packages/snapshots split** - Must use correct section for traversal
6. **Yarn berry husk creation** - Must ensure berry, not classic
7. **Finding yarn classic verification target** - Most projects migrated

### Low (Acceptable variance)

8. **Version drift in transitive deps** - Compare names only
9. **"Extra" packages in monorepo** - DevDeps, build tools

---

## Appendix: Verification Script Template

```bash
#!/bin/bash
#
# Template for package manager verification
# Replace PLACEHOLDERS with actual values
#

set -ex

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/artifacts/PACKAGE_MANAGER-TARGET"
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

# Clone monorepo
git clone --depth 1 --branch BRANCH REPO_URL "$ARTIFACTS/monorepo"

# Get package info
PKG_NAME=$(jq -r .name "$ARTIFACTS/monorepo/WORKSPACE_PATH/package.json")
PKG_VERSION=$(jq -r .version "$ARTIFACTS/monorepo/WORKSPACE_PATH/package.json")

# Extract from monorepo
flatlock-deps "$ARTIFACTS/monorepo/LOCKFILE" -w WORKSPACE_PATH \
  | PLATFORM_EXCLUSIONS \
  | sort -u > "$ARTIFACTS/monorepo.flatlock.txt"

# Create husk
mkdir -p "$ARTIFACTS/husk"
cd "$ARTIFACTS/husk"
echo "{\"dependencies\":{\"$PKG_NAME\":\"$PKG_VERSION\"}}" > package.json
PACKAGE_MANAGER_INSTALL

# Extract from husk
flatlock-deps "$ARTIFACTS/husk/LOCKFILE" \
  | grep -v "^$PKG_NAME$" \
  | PLATFORM_EXCLUSIONS \
  | sort -u > "$ARTIFACTS/husk.flatlock.txt"

# Compare
MISSING=$(comm -23 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" | wc -l)
EXTRA=$(comm -13 "$ARTIFACTS/husk.flatlock.txt" "$ARTIFACTS/monorepo.flatlock.txt" | wc -l)

if [ "$MISSING" -eq 0 ]; then
  echo "PASS: $PKG_NAME@$PKG_VERSION (extra: $EXTRA)"
  exit 0
else
  echo "FAIL: $MISSING missing, $EXTRA extra"
  exit 1
fi
```
