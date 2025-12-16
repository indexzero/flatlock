# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `FlatlockSet` class for Set-like operations on lockfile dependencies
  - Factory methods: `fromPath()`, `fromString()`
  - Set operations: `union()`, `intersection()`, `difference()`
  - Predicates: `isSubsetOf()`, `isSupersetOf()`, `isDisjointFrom()`
  - Traversal: `dependenciesOf()` for workspace-specific SBOM generation
- Comprehensive test suite for FlatlockSet (48 test cases)

## [1.1.0] - 2025-12-16

### Added
- Separate export path `flatlock/compare` for comparison utilities
- Export lockfile key parsing utilities: `parseNpmKey`, `parsePnpmKey`, `parseYarnClassicKey`, `parseYarnBerryKey` for advanced use cases
- TypeScript type declarations with proper JSDoc annotations for all public APIs

### Changed
- **Breaking**: `compare()` and `compareAll()` are no longer exported from main entry point - import from `flatlock/compare` instead
- **Breaking (internal)**: Normalize parser function naming to `parseLockfileKey` across all parser modules for consistency
- Move `@npmcli/arborist` from devDependencies to optionalDependencies (only needed for `flatlock/compare`)
- Refactor `flatlock-cmp` CLI to use extracted comparison logic from `src/compare.js`
- Replace `npm run` with `pnpm run` in package.json scripts

### Removed
- Remove `src/support.js` - functionality consolidated into individual parser modules for better maintainability
- Remove dynamic import and lazy-loading pattern for Arborist (now static import in separate entry point)

## [1.0.1] - 2025-12-11

### Fixed
- Fix broken GitHub URLs in package.json (homepage, repository, bugs) and README.md image path
- Correct relative URLs that would fail when package is published to npm registry

## [1.0.0] - 2025-12-11

Initial release of flatlock - the Matlock of lockfile parsers.

### Added
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

### Changed
- **Semantic filtering**: Yield only external dependencies, automatically skipping workspace packages, local file references (`file:`, `link:`), and symlinks to focus on registry-published dependencies

### Notes
- Designed for use cases that need package enumeration without dependency resolution: SBOM generation, vulnerability scanning, license compliance, integrity verification
- For full dependency tree analysis ("why is X installed?"), use `@npmcli/arborist` instead

[unreleased]: https://github.com/indexzero/flatlock/compare/1.1.0...HEAD
[1.1.0]: https://github.com/indexzero/flatlock/compare/1.0.0...1.1.0
[1.0.1]: https://github.com/indexzero/flatlock/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/indexzero/flatlock/releases/tag/1.0.0
