# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-01-18

### 🔒 Security
- Upgrade `node-tar` to 7.5.3 to address CVE-2026-23745

### 🆕 Added
- **flatcover input flexibility**: Accept packages from multiple sources beyond lockfiles
  - `--list` (`-l`): Read from JSON array file of `{name, version}` objects
  - `-` (stdin): Stream NDJSON package objects for pipeline integration
  ```bash
  # From JSON list file
  flatcover --list packages.json --cover --summary

  # From stdin (NDJSON)
  echo '{"name":"lodash","version":"4.17.21"}' | flatcover - --cover
  ```
- `--full` flag for flatcover to include integrity hash and resolved URL in output

### 🚧 Changed
- `flatlock-cmp` benchmark mode uses `flatlock.collect()` with `console.time()` for more accurate parse performance measurements

## [1.3.0] - 2026-01-14

### 🆕 Added
- `repoDir` option for `dependenciesOf()`
  ```javascript
  const deps = await lockfile.dependenciesOf(pkg, {
    workspacePath: 'packages/vue',
    repoDir: '.'
  });
  ```
- pnpm v9 `snapshots` section parsing
- CLI: `flatlock` (extract), `flatlock-cmp` (verify), `flatcover` (registry check)
- ncc build workflow for standalone binaries

### 🚧 Changed
- **Breaking**: `dependenciesOf()` is now async
- Rename `bin/flatlock-deps.js` to `bin/flatlock.js`

### 🐞 Fixed
- yarn-berry: separate prod/dev traversal (was merging both)
- pnpm v9: include snapshots in traversal (was packages only)
- `flatcover` now respects registry URL path (e.g., `/npm/` prefix) when fetching packages from proxied or scoped registries (#7)

### 🤝 Contributors

- @ppalucha - `fix(flatcover): respect registry URL path when fetching packages` (#7)

## [1.2.0] - 2025-01-05

### 🆕 Added
- **`FlatlockSet` class** for Set-like operations on lockfile dependencies
  - Factory methods: `fromPath()`, `fromString()`
  - Set operations: `union()`, `intersection()`, `difference()`
  - Predicates: `isSubsetOf()`, `isSupersetOf()`, `isDisjointFrom()`
  - Traversal: `dependenciesOf()` for workspace-specific SBOM generation
- **pnpm parser rewrite** supporting all versions (shrinkwrap v3/v4 through v9)
  - Modular architecture: `detect.js`, `shrinkwrap.js`, `v5.js`, `v6plus.js`
  - Auto-detect format from spec patterns; handle all peer dependency suffix styles
- **Comparison tooling** with ground-truth verification via native parsers
  - Optional dependencies: `@pnpm/lockfile.fs`, `@yarnpkg/core`, `@cyclonedx/cyclonedx-npm`
  - Superset detection: pnpm reachability divergence is expected behavior, not an error
- **Documentation**: `doc/PNPM-LOCKFILE-VERSIONS.md` comprehensive pnpm lockfile format evolution
- **Test reorganization**: per-parser test files, `test/SCENARIOS.md` documenting test coverage
- Export `parseYarnClassic` function for standardized yarn classic lockfile parsing

### 🚧 Changed
- **Breaking**: Node.js 22+ required (dropped v20 support)
- **Breaking**: Rename `identical` to `equinumerous` in comparison results (set-theoretic terminology)
- CI matrix updated to test Node.js 22 and 24 on x64 and arm64
- Parsers now accept pre-parsed lockfile objects for better performance (eliminates redundant parsing)
- Consolidate `Dependency` type definition into `src/parsers/types.js`
- Standardize `@yarnpkg/lockfile` parse function access across all modules via `parseYarnClassic`

### 🐞 Fixed
- Fix `collect()` path detection for YAML lockfile content (was incorrectly treating YAML as a path)

## [1.1.0] - 2025-12-16

### 🆕 Added
- Separate export path `flatlock/compare` for comparison utilities
- Export lockfile key parsing utilities: `parseNpmKey`, `parsePnpmKey`, `parseYarnClassicKey`, `parseYarnBerryKey` for advanced use cases
- TypeScript type declarations with proper JSDoc annotations for all public APIs

### 🚧 Changed
- **Breaking (internal)**: Normalize parser function naming to `parseLockfileKey` across all parser modules for consistency
- Move `@npmcli/arborist` from devDependencies to optionalDependencies (only needed for `flatlock/compare`)
- Refactor `flatlock-cmp` CLI to use extracted comparison logic from `src/compare.js`
- Replace `npm run` with `pnpm run` in package.json scripts

### 🗑️ Removed
- Remove `src/support.js` - functionality consolidated into individual parser modules for better maintainability
- Remove dynamic import and lazy-loading pattern for Arborist (now static import in separate entry point)

## [1.0.1] - 2025-12-11

### 🐞 Fixed
- Fix broken GitHub URLs in package.json (homepage, repository, bugs) and README.md image path
- Correct relative URLs that would fail when package is published to npm registry

## [1.0.0] - 2025-12-11

Initial release of flatlock - the Matlock of lockfile parsers.

### 🆕 Added
- **Core functionality**: Extract package dependencies from npm, yarn (classic + berry), and pnpm lockfiles without building dependency graphs
- **Generator-based streaming API** for memory-efficient processing of large lockfiles via `fromPath()`, `fromString()`, and format-specific functions
- **Multi-format support**:
  - npm: package-lock.json (v1, v2, v3)
  - pnpm: pnpm-lock.yaml (v5.4, v6, v9)
  - yarn classic: yarn.lock v1
  - yarn berry: yarn.lock v2+
- **Smart type detection**: Content-aware lockfile format detection with JSON structure validation via `detectType()`
- **Validation tooling**: `flatlock-cmp` CLI to compare output against established parsers (`@npmcli/arborist`, `@yarnpkg/lockfile`, `@yarnpkg/parsers`)
- **Real-world test coverage**: Comprehensive test fixtures from production lockfiles (base64-encoded to prevent dependabot noise)
- **Security hardening**: Resistance to spoofing attacks (e.g., malicious packages using `__metadata` in name strings to mimic lockfile structure)
- **Helper functions**: `collect()` to materialize all packages into an array, `tryFromPath()` and `tryFromString()` for Result-based error handling

### 🚧 Changed
- **Semantic filtering**: Yield only external dependencies, automatically skipping workspace packages, local file references (`file:`, `link:`), and symlinks to focus on registry-published dependencies

### 📝 Notes
- Designed for use cases that need package enumeration without dependency resolution: SBOM generation, vulnerability scanning, license compliance, integrity verification
- For full dependency tree analysis ("why is X installed?"), use `@npmcli/arborist` instead

[unreleased]: https://github.com/indexzero/flatlock/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/indexzero/flatlock/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/indexzero/flatlock/compare/1.2.0...v1.3.0
[1.2.0]: https://github.com/indexzero/flatlock/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/indexzero/flatlock/compare/1.0.0...1.1.0
[1.0.1]: https://github.com/indexzero/flatlock/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/indexzero/flatlock/releases/tag/1.0.0
