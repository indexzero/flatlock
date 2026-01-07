# Monorepo Workspace SBOM Tests

These tests validate that `FlatlockSet.dependenciesOf()` produces accurate per-workspace SBOMs from a single lockfile.

## The Core Question

> Given a monorepo lockfile and a workspace's `package.json`, does `flatlock.dependenciesOf()` produce the same dependency set as CycloneDX?

In a monorepo, different workspaces have different dependency trees. A security team scanning `packages/api` should not see vulnerabilities from `packages/admin-dashboard` if they are unrelated.

## How It Works

Tests clone real repositories at test time, install dependencies, run CycloneDX, run flatlock, and compare the results. No pre-generated fixtures.

This approach is slower but honest. We test against real repos at their current state, not stale snapshots.

## Test Flow

1. Clone repo to temp directory (`git clone --depth 1`)
2. Write security config (`.npmrc` with `ignore-scripts=true`)
3. Run package manager install
4. Run CycloneDX for workspace (`cyclonedx-npm -w <workspace>`)
5. Run flatlock `dependenciesOf()` for workspace
6. Compare the two sets

## Security

Running `npm install` on untrusted code is dangerous. Install scripts can execute arbitrary code.

All tests write `.npmrc` with `ignore-scripts=true` before install. This prevents supply chain attacks during testing.

```
ignore-scripts=true
audit=false
fund=false
```

This is non-negotiable.

## Support Files

```
test/support/
  monorepo.js   # Shared: cloneRepo, writeSecurityConfig, getCycloneDXPackages,
                #         getFlatlockPackages, testWorkspace, cleanup
  npm.js        # npm: install, lockfileName, packageManager
  pnpm.js       # pnpm: install, lockfileName, packageManager
  yarn.js       # yarn: install, lockfileName, packageManager
```

Each package manager module exports the same interface. The monorepo module uses them.

## What Passes

A test passes if flatlock finds everything CycloneDX finds. Flatlock may find more (superset is valid).

```javascript
// This passes:
cyclonedx: { 'lodash@4.17.21', 'express@4.18.2' }
flatlock:  { 'lodash@4.17.21', 'express@4.18.2', 'debug@4.3.4' }  // superset ok

// This fails:
cyclonedx: { 'lodash@4.17.21', 'express@4.18.2' }
flatlock:  { 'lodash@4.17.21' }  // missing express
```

## Failure Modes

**flatlock missing packages**: Graph traversal stopped too early. Check workspace path and dependency type filters.

**CycloneDX failed**: Workspace might not exist at that path. Check `package.json` validity.

**Clone failed**: Network issue or repo moved. Check the GitHub URL.

**Install failed**: Package manager not installed, or security config rejected by repo.

## Trade-offs

- Tests require network access
- Tests require git, npm/pnpm/yarn, and npx
- Tests are slower than fixture-based tests
- Tests can break if upstream repos change structure

We accept these trade-offs because testing against real repos catches real bugs.

## Current Status

| Package Manager | Monorepo Test | Ground Truth Test |
|-----------------|---------------|-------------------|
| npm | 19=19 PASS | 21 vs 19 **FAIL** |
| pnpm | skipped | **FAIL** - 0 deps |
| yarn | skipped | **FAIL** - wrong deps |

### The Bullshit of Lockfile-Based Tests

The existing tests compare flatlock against the **monorepo's lockfile** via `cyclonedx-npm -w`. This is bullshit because:

1. Monorepo lockfiles can be **stale** relative to published packages
2. Users get **different dependencies** when they `npm install socket.io@4.8.3`
3. Tests pass against a lie

```
EXISTING TEST (monorepo lockfile):  19 = 19 ✓ PASS
GROUND TRUTH (fresh npm install):   21 vs 19 ✗ FAIL
```

### Ground Truth Method

The real test: install the published package fresh, compare against flatlock's output.

```bash
# Compare package NAMES (versions will differ due to lockfile pinning)
./test/monorepos/scripts/verify-packages.sh socketio/socket.io main packages/socket.io npm

# This reveals:
# - undici-types is missing from flatlock output
# - The monorepo lockfile is stale
# - Users would get an incomplete SBOM
```

The lockfile is the source of truth for **what versions are pinned**. But it cannot be the source of truth for **what packages exist** if it's stale.

## Test Matrix

For each monorepo, we test **3-5 representative workspaces** with different dependency patterns:

| Pattern | Example | Why It Matters |
|---------|---------|----------------|
| Core/shared library | `packages/core` | Most other workspaces depend on it |
| Leaf application | `apps/web` | Has many deps, nothing depends on it |
| Utility package | `packages/utils` | Few deps, used by several workspaces |
| Dev tooling | `packages/eslint-config` | devDependencies only |
| Complex peer deps | `packages/plugin-*` | Tests peer dependency handling |

### pnpm Monorepos

| Repository | Test Workspaces |
|------------|-----------------|
| `vuejs/core` | `packages/vue`, `packages/reactivity`, `packages/compiler-core` |
| `vitejs/vite` | `packages/vite`, `packages/plugin-vue`, `packages/create-vite` |
| `pnpm/pnpm` | `packages/pnpm`, `packages/core`, `packages/resolve-dependencies` |
| `vercel/next.js` | `packages/next`, `packages/eslint-plugin-next`, `packages/create-next-app` |
| `sveltejs/svelte` | `packages/svelte`, `playgrounds/sandbox` |

### npm Workspaces Monorepos

| Repository | Test Workspaces |
|------------|-----------------|
| `npm/cli` | `workspaces/arborist`, `workspaces/libnpmexec`, `workspaces/config` |
| `socketio/socket.io` | `packages/socket.io`, `packages/engine.io`, `packages/socket.io-client` |
| `lerna/lerna` | `packages/lerna`, `packages/legacy-structure/commands/create` |
| `FreeCodeCamp/FreeCodeCamp` | `client`, `api`, `curriculum` |
| `feathersjs/feathers` | `packages/feathers`, `packages/express`, `packages/socketio` |

### Yarn Berry Monorepos

| Repository | Test Workspaces |
|------------|-----------------|
| `babel/babel` | `packages/babel-core`, `packages/babel-parser`, `packages/babel-cli` |
| `facebook/jest` | `packages/jest`, `packages/jest-cli`, `packages/expect` |
| `storybookjs/storybook` | `code/core`, `code/renderers/react`, `code/addons/essentials` |
| `prettier/prettier` | `src/cli`, `src/language-js` |
| `yarnpkg/berry` | `packages/yarnpkg-core`, `packages/yarnpkg-cli`, `packages/yarnpkg-pnp` |

### Yarn Classic Monorepos

| Repository | Test Workspaces |
|------------|-----------------|
| `facebook/react` | `packages/react`, `packages/react-dom`, `packages/scheduler` |
| `webpack/webpack` | `lib`, `packages/webpack-cli` |
| `microsoft/vscode` | `extensions/git`, `extensions/typescript-language-features` |
| `mui/material-ui` | `packages/mui-material`, `packages/mui-system`, `packages/mui-lab` |
| `TryGhost/Ghost` | `ghost/core`, `ghost/admin`, `ghost/api-framework` |
