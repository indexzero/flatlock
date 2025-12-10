# Complete guide to JavaScript lockfile parsing packages

**snyk-nodejs-lockfile-parser** stands as the most comprehensive multi-format lockfile parser in the Node.js ecosystem, supporting npm, yarn (v1/v2+), and pnpm lockfiles with a public API. For format-specific needs, each package manager provides official parsers: **@npmcli/arborist** for npm, **@yarnpkg/lockfile** and **@yarnpkg/parsers** for yarn, and **@pnpm/lockfile-file** for pnpm. Hidden implementations exist within security scanners, SBOM generators, and conversion tools, though most dependency analysis tools like depcheck and npm-check surprisingly do not parse lockfiles at all—they analyze source code or node_modules directly.

## Official package manager parsers handle their native formats best

### npm and npm-shrinkwrap.json

**@npmcli/arborist** is npm's official dependency tree manager, bundled with npm CLI and actively maintained. It handles all lockfileVersion formats (1, 2, 3), both package-lock.json and npm-shrinkwrap.json, workspace lockfiles, and validates integrity hashes. The internal `Shrinkwrap` class keeps lockfile state synchronized.

```javascript
const Arborist = require('@npmcli/arborist')
const arb = new Arborist({ path: '/path/to/package/root' })

// Read lockfile without needing node_modules
const tree = await arb.loadVirtual()
// tree.meta contains resolved/integrity values
// tree.children = Map of packages in node_modules
```

**lockfile-lint-api** (~224K weekly downloads) provides security-focused parsing for npm lockfiles. Rather than building dependency trees, it extracts package URLs for security validation—detecting malicious package injection and validating registry hosts.

```javascript
const { ParseLockfile, ValidateHost } = require('lockfile-lint-api')
const parser = new ParseLockfile({ lockfilePath: './package-lock.json', lockfileType: 'npm' })
const lockfile = parser.parseSync()
```

**npm-logical-tree** is deprecated and archived—avoid it. It only supports lockfileVersion 1 (npm v5-v6 era) and has been superseded by @npmcli/arborist.

### yarn.lock parsing requires choosing between v1 and v2+ formats

**@yarnpkg/lockfile** (~12.5M weekly downloads) is the official yarn v1 parser but **has not been updated in 7 years** and does not support yarn v2+ lockfiles. It throws "Unknown token" errors on berry format files.

```javascript
const lockfile = require('@yarnpkg/lockfile')
const file = fs.readFileSync('yarn.lock', 'utf8')
const json = lockfile.parse(file)
// Returns { type: 'success' | 'merge', object: {...} }
```

**@yarnpkg/parsers** (~5.4M weekly downloads) is the official yarn berry parser that handles both v1 and v2+ formats. It detects format by checking for the `__metadata` key present only in v2+ lockfiles.

```javascript
const { parseSyml, stringifySyml } = require('@yarnpkg/parsers')
const parsed = parseSyml(fs.readFileSync('yarn.lock', 'utf8'))

if (parsed.__metadata) {
  console.log('Yarn v2+ lockfile, version:', parsed.__metadata.version)
} else {
  console.log('Yarn v1 lockfile')
}
```

The key format difference: yarn v1 uses a custom indentation-based format while v2+ uses YAML-like syntax with `__metadata`, `resolution` instead of `resolved`, and `checksum` instead of `integrity`. Both parsers handle merge conflict auto-resolution.

### pnpm lockfile parsing through official @pnpm packages

**@pnpm/lockfile-file** (~268K weekly downloads) is pnpm's official lockfile reader/writer, handling both the wanted lockfile (pnpm-lock.yaml) and current lockfile (node_modules/.pnpm-lock.yaml).

```javascript
import { readWantedLockfile, existsWantedLockfile } from '@pnpm/lockfile-file'

const lockfile = await readWantedLockfile(projectPath, { ignoreIncompatible: false })
// lockfile.importers = workspace projects
// lockfile.packages = external dependencies
```

**@pnpm/lockfile-types** (~361K weekly downloads) provides TypeScript definitions revealing the complete lockfile structure—essential for type-safe parsing. **@pnpm/dependency-path** (~975K weekly downloads) handles the unique dependency path format used in pnpm lockfiles.

pnpm lockfile versions have evolved significantly: **version 5.x** (pnpm v6-7) included hashes in package IDs, **version 6.0** (pnpm v8) removed hashes for better git merge handling, and **version 9.0** (pnpm v9) aligns version numbers with pnpm's major version.

## snyk-nodejs-lockfile-parser is the most comprehensive multi-format solution

**snyk-nodejs-lockfile-parser** (~74K weekly downloads) parses all major lockfile formats through a unified API, outputting either dependency trees or modern dependency graphs via @snyk/dep-graph.

| Format | Version Support |
|--------|----------------|
| package-lock.json | v2, v3 (dep graph); v1 (dep tree only) |
| npm-shrinkwrap.json | All versions |
| yarn.lock | v1 and v2+ |
| pnpm-lock.yaml | 5.x, 6.x, 9.x |

```javascript
const { buildDepTree, buildDepGraph, LockfileType } = require('snyk-nodejs-lockfile-parser')

const manifestFile = fs.readFileSync('package.json', 'utf-8')
const lockFile = fs.readFileSync('package-lock.json', 'utf-8')

// Modern dependency graph (recommended)
const depGraph = await buildDepGraph(manifestFile, lockFile, {
  dev: true,
  lockfileType: LockfileType.npm
})

// Legacy dependency tree
const depTree = await buildDepTree(
  manifestFile, lockFile, true,
  LockfileType.yarn,  // or .npm, .pnpm, .yarn2
  true, 'package.json'
)
```

The package requires both manifest (package.json) and lockfile content. It uses @yarnpkg/lockfile internally for yarn v1, @yarnpkg/core for v2+, and handles pnpm's complex nested structure.

## Hidden implementations exist within larger tools

### @npmcli/arborist contains an internal yarn.lock parser

Arborist's `lib/yarn-lock.js` module parses yarn v1 lockfiles when building ideal trees for npm install. The `loadVirtual()` method reads both package-lock.json and yarn.lock. This implementation supports reading and writing back changes but isn't exposed as a standalone parser API.

### Security tools with embedded parsers

**audit-ci** (IBM) wraps native package manager audits rather than parsing lockfiles directly—it calls `npm audit`, `yarn audit`, or `pnpm audit` under the hood. It supports npm, yarn classic, and pnpm but notably **does not support yarn v4** (which provides similar functionality natively).

**lockfile-lint** (~180K weekly downloads) parses npm and yarn v1 lockfiles for security policy validation but **does not support pnpm** because pnpm lockfiles don't maintain tarball source URLs in the same way.

**Renovate Bot** delegates all lockfile parsing to native package managers. Its `lib/modules/manager/npm/` directory contains post-update handling logic but no standalone parsers.

**Dependabot** uses Ruby-based parsers in `npm_and_yarn/lib/dependabot/`, not npm packages—these aren't accessible from Node.js applications.

### SBOM generators parse lockfiles for dependency enumeration

**@cyclonedx/cdxgen** parses all major lockfile formats (package-lock.json, yarn.lock, pnpm-lock.yaml) during SBOM generation. It combines lockfile parsing with AST analysis via babel-parser for comprehensive dependency discovery.

```javascript
const { createBom } = require('@cyclonedx/cdxgen')
const bom = await createBom('./project', { specVersion: '1.5' })
```

**@cyclonedx/cyclonedx-npm** produces highly accurate SBOMs for npm projects specifically, described as "probably the most accurate SBOM generator for npm-based projects."

The built-in **npm sbom** command (npm v9+) reads package-lock.json or npm-shrinkwrap.json with the `--package-lock-only` option, outputting SPDX or CycloneDX format.

**Syft** (Anchore) uses a `javascript-lock-cataloger` for lockfile detection across all formats but is a Go-based CLI tool, not an npm package.

## Most dependency analysis tools skip lockfile parsing entirely

**depcheck**, **npm-check**, **npm-check-updates**, **madge**, and **dependency-cruiser** all analyze source code imports or walk node_modules—they do not parse lockfiles. This is a significant finding for anyone assuming these tools understand lockfile state.

- **depcheck** uses AST parsers (ES6, JSX, TypeScript) on source files
- **npm-check** uses `read-installed` to walk node_modules
- **npm-check-updates** explicitly states "It will not update your lockfile"
- **license-checker** reads licenses from node_modules/*/package.json files

**@rushstack/lockfile-explorer** (~255 weekly downloads) provides a visual UI for analyzing pnpm lockfiles specifically, supporting Rush monorepos and standalone pnpm workspaces.

## Lockfile conversion has significant gaps

**synp** (784 GitHub stars, actively maintained) is the primary tool for bidirectional npm↔yarn conversion, but requires an existing node_modules directory and has documented limitations with workspaces, bundled dependencies, and platform-specific optional packages.

```javascript
const { npmToYarn, yarnToNpm } = require('synp')
const yarnLock = npmToYarn('/path/to/project')  // generates yarn.lock string
const packageLock = yarnToNpm('/path/to/project')  // generates package-lock.json string
```

**pnpm import** and **yarn import** are native commands that convert FROM other formats but not TO them.

| Conversion | Tool Available |
|------------|---------------|
| npm → yarn | synp, yarn import |
| yarn → npm | synp |
| npm/yarn → pnpm | pnpm import |
| pnpm → npm/yarn | **None available** |
| npm v1↔v2↔v3 | package-lock-converter |
| yarn v2+ → v1 | @vht/yarn-lock-converter |

**Critical gap**: No tool converts FROM pnpm lockfiles to npm or yarn formats. The pnpm maintainers explicitly do not support this direction.

## Version-specific handling is essential

### npm lockfileVersion differences

| Version | npm Version | Structure |
|---------|-------------|-----------|
| 1 | npm 5-6 | `dependencies` object with nested structure |
| 2 | npm 7+ | Both `packages` (path-based) AND `dependencies` (backwards compat) |
| 3 | npm 7+ hidden | Only `packages`, no `dependencies`, used in node_modules/.package-lock.json |

Modern parsers prefer the `packages` structure when available. Version 3 lockfiles appear only in hidden locations.

### yarn format differences

Yarn v1 uses a custom indentation-based format; v2+ uses YAML-like syntax. The `__metadata` key containing `version` and `cacheKey` fields only appears in v2+. Resolution fields differ: v1 uses `resolved` and `integrity` while v2+ uses `resolution` and `checksum`. @yarnpkg/parsers handles both automatically.

### pnpm lockfileVersion evolution

Version 6.0 made significant breaking changes: removed hashes from package IDs, reorganized the `importers` section, and improved git merge conflict resistance. Some tools like Microsoft's sbom-tool have known issues with newer pnpm lockfile versions.

## Recommendations by use case

**For building dependency trees/graphs**: Use snyk-nodejs-lockfile-parser for multi-format support, or official packages (@npmcli/arborist, @yarnpkg/parsers, @pnpm/lockfile-file) for single-format accuracy.

**For security validation**: Use lockfile-lint for URL/host validation, snyk-nodejs-lockfile-parser for vulnerability scanning integration.

**For SBOM generation**: Use @cyclonedx/cdxgen for multi-format support, @cyclonedx/cyclonedx-npm for npm-specific accuracy, or native npm sbom for simple npm projects.

**For lockfile conversion**: Use synp for npm↔yarn, pnpm import for migrating to pnpm, yarn import for migrating to yarn. Accept that pnpm→npm/yarn conversion is unsupported.

**For visualization**: Use @rushstack/lockfile-explorer for pnpm lockfiles in Rush or standalone pnpm projects.

## Complete package reference table

| Package | npm | yarn v1 | yarn v2+ | pnpm | Public API | Active |
|---------|-----|---------|----------|------|------------|--------|
| **snyk-nodejs-lockfile-parser** | ✅ v2-3 | ✅ | ✅ | ✅ 5.x/6.x/9.x | ✅ | ✅ |
| **@npmcli/arborist** | ✅ all | ✅ (internal) | ❌ | ❌ | ✅ | ✅ |
| **@yarnpkg/lockfile** | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **@yarnpkg/parsers** | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **@pnpm/lockfile-file** | ❌ | ❌ | ❌ | ✅ all | ✅ | ✅ |
| **lockfile-lint-api** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **synp** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **@cyclonedx/cdxgen** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **@rushstack/lockfile-explorer** | ❌ | ❌ | ❌ | ✅ | CLI | ✅ |
| **npm-logical-tree** | ✅ v1 only | ❌ | ❌ | ❌ | ✅ | ❌ archived |

## Conclusion

The Node.js lockfile parsing ecosystem is fragmented but functional. **snyk-nodejs-lockfile-parser** provides the broadest coverage for applications needing multi-format support, while official packages from each package manager offer the most accurate parsing for their respective formats. The notable gap is pnpm-to-other-format conversion, and many popular dependency tools surprisingly don't parse lockfiles at all. For new projects requiring lockfile analysis, combining the official parsers with snyk-nodejs-lockfile-parser covers nearly all use cases, while being aware that SBOM generators like @cyclonedx/cdxgen provide lockfile parsing as a side effect of their primary function.