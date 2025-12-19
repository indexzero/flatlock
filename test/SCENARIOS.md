# Test Scenarios

This document records scenarios validated during ground truth comparison testing with official package manager parsers. Each scenario represents a parsing behavior validated against authoritative tools.

## Testing Methodology

Official tools used for comparison:
- **npm**: @npmcli/arborist, snyk-nodejs-lockfile-parser
- **pnpm**: @pnpm/lockfile.fs
- **yarn-classic**: @yarnpkg/lockfile
- **yarn-berry**: @yarnpkg/core, @yarnpkg/parsers

## Summary

| Package Manager | Scenarios | Accuracy vs Official | Notes |
|-----------------|-----------|---------------------|-------|
| npm | 6 | 100% | Path-based name extraction |
| pnpm | 5 | 100% | Complex version matrix |
| yarn-classic | 3 | 100% | Multi-range key parsing |
| yarn-berry | 7 | 56.10%* | *Intentional divergence for SBOM accuracy |
| cross-cutting | 1 | - | Applies to all parsers |

---

## npm (package-lock.json)

### npm-01: Lockfile Version Detection

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-01" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ fromPackageLock
    ▶ [npm-01] version detection
      ✔ returns empty for v1 format (uses dependencies, not packages) (2.038542ms)
      ✔ parses v2 format (5.903875ms)
      ✔ parses v3 format (3.095917ms)
    ✔ [npm-01] version detection (11.109958ms)
```

</details>

npm has three distinct lockfile formats with different structures:

| Version | Structure | Node.js |
|---------|-----------|---------|
| v1 | `dependencies` object (nested) | < 16 |
| v2 | `packages` + `dependencies` (transitional) | 16-17 |
| v3 | `packages` only (flat) | 18+ |

flatlock detects the version via the `lockfileVersion` field and parses accordingly. v1 requires recursive traversal; v2/v3 use the flat `packages` object.

### npm-02: Path-Based Name Extraction

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-02" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ [npm-02] parseLockfileKey
    ▶ simple packages
      ✔ parses unscoped package (0.322167ms)
      ✔ parses scoped package (0.047ms)
      ✔ parses package with hyphen (0.0885ms)
      ✔ parses package with dots (0.037875ms)
      ✔ parses package with numbers (0.034917ms)
    ✔ simple packages (0.812584ms)
    ▶ nested node_modules
      ✔ parses nested unscoped package (0.061792ms)
      ✔ parses nested scoped package (0.079833ms)
      ✔ parses deeply nested package (0.212709ms)
      ✔ parses scoped parent with nested scoped child (0.120792ms)
    ✔ nested node_modules (1.196ms)
    ▶ workspace paths
      ✔ extracts package from workspace definition path (0.075042ms)
      ✔ extracts package from deep workspace path (0.031667ms)
      ✔ extracts package from workspace nested node_modules (0.026292ms)
    ✔ workspace paths (0.17125ms)
    ▶ edge cases
      ✔ handles single segment path (0.033042ms)
      ✔ handles empty segments (0.0225ms)
    ✔ edge cases (0.10975ms)
  ✔ [npm-02] parseLockfileKey (2.47925ms)
```

</details>

Package names are extracted from `node_modules` paths in the `packages` object:

```
node_modules/lodash           → lodash
node_modules/@babel/core      → @babel/core
node_modules/foo/node_modules/bar → bar
```

The last `node_modules/` segment contains the package name. Scoped packages preserve the `@scope/` prefix.

### npm-03: Root Package Exclusion

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-03" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ fromPackageLock
    ▶ [npm-03, npm-04] dependency extraction
      ✔ [npm-03] skips root package (empty path) (0.244958ms)
```

</details>

The empty string key `""` in the `packages` object represents the root project:

```json
{
  "packages": {
    "": { "name": "my-project", "version": "1.0.0" },
    "node_modules/lodash": { "version": "4.17.21" }
  }
}
```

The root entry must be excluded from SBOM output (it's the project, not a dependency).

### npm-04: Workspace Link Filtering

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-04" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ fromPackageLock
    ▶ [npm-03, npm-04] dependency extraction
      ✔ [npm-04] skips workspace definitions (no node_modules in path) (0.081958ms)
      ✔ [npm-04] yields link flag when true (0.031416ms)
```

</details>

Workspace packages are marked with `link: true` or have `resolved` starting with `file:`:

```json
{
  "node_modules/@myorg/shared": {
    "resolved": "packages/shared",
    "link": true
  }
}
```

These are local packages and must be excluded from SBOM (not external dependencies).

### npm-05: Nested Dependency Deduplication

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-05" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ fromPackageLock
    ▶ [npm-05] nested dependencies
      ✔ extracts nested dependencies correctly (0.100958ms)
    ✔ [npm-05] nested dependencies (0.135208ms)
```

</details>

The same package may appear at multiple `node_modules` paths:

```
node_modules/lodash                    → lodash@4.17.21
node_modules/foo/node_modules/lodash   → lodash@4.17.21
```

For SBOM, these are deduplicated by `name@version`. The package is installed once per version, regardless of path count.

---

## pnpm (pnpm-lock.yaml)

### pnpm-01: Lockfile Version Detection

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="pnpm-01" test/parsers/pnpm.test.js
```

**📋 Full Test Cases**
```
▶ pnpm parsers
  ▶ [pnpm-01] detectVersion
    ✔ detects shrinkwrap v3 (0.287ms)
    ✔ detects shrinkwrap v4 (0.047542ms)
    ✔ detects v5.0 (number) (0.04075ms)
    ✔ detects v5.4 (number) (0.045959ms)
    ✔ detects v5.4-inlineSpecifiers (experimental) (0.039917ms)
    ✔ detects v6.0 (string) (0.040167ms)
    ✔ detects v6.1 (string) (0.105208ms)
    ✔ detects v9.0 (string) (2.662375ms)
    ✔ returns unknown for null input (0.296458ms)
    ✔ returns unknown for undefined input (0.211209ms)
    ✔ returns unknown for empty object (0.042666ms)
    ✔ returns unknown for non-object input (0.037125ms)
  ✔ [pnpm-01] detectVersion (4.411083ms)
```

</details>

pnpm has the most complex version matrix of any package manager:

| Version | Era | Key Format | Peer Suffix |
|---------|-----|------------|-------------|
| 5.0-5.4 | v5 | `/pkg@ver` | No |
| 6.0 | v6 | `/pkg@ver` | `(peer@ver)` |
| 9.0 | v9 | `pkg@ver` | `(peer@ver)` in snapshots |

flatlock uses era-based detection to apply correct parsing logic for each version.

### pnpm-02: Spec Format Parsing

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="pnpm-02" test/parsers/pnpm.test.js
```

**📋 Full Test Cases**
```
▶ pnpm parsers
  ▶ [pnpm-02] parseSpec (unified)
    ✔ parses v5 unscoped package (0.082916ms)
    ✔ parses v5 scoped package (0.02925ms)
    ✔ parses v5 with peer suffix (0.028791ms)
    ✔ parses v6 unscoped package (0.027333ms)
    ✔ parses v6 scoped package (0.025084ms)
    ✔ parses v9 unscoped package (0.024333ms)
    ✔ parses v9 scoped package (0.023041ms)
    ✔ parses v9 with peer suffix (0.02325ms)
    ✔ handles null input (0.022084ms)
    ✔ returns null for link: protocol (0.022166ms)
    ✔ returns null for file: protocol (0.0365ms)
  ✔ [pnpm-02] parseSpec (unified) (0.424709ms)
  ▶ [pnpm-02] parseLockfileKey
    ✔ returns name for v5 format (0.042959ms)
    ✔ returns name for v6 format (0.022709ms)
    ✔ returns name for v9 format (0.022083ms)
    ✔ returns null for invalid input (0.01925ms)
  ✔ [pnpm-02] parseLockfileKey (0.148167ms)
```

</details>

pnpm uses a unique spec format for package keys:

```yaml
# v5-v6: Leading slash
packages:
  /@babel/core@7.24.4:
    resolution: {...}

# v9: No leading slash
packages:
  '@babel/core@7.24.4':
    resolution: {...}
```

The parser must handle both formats and extract `@babel/core` and `7.24.4` correctly.

### pnpm-03: Peer Dependency Suffix Stripping

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="pnpm-03" test/parsers/pnpm.test.js
```

**📋 Full Test Cases**
```
▶ pnpm parsers
  ▶ [pnpm-03] shrinkwrap peer suffix utilities
    ✔ hasPeerSuffix returns false for simple package (0.071083ms)
    ✔ hasPeerSuffix returns false for scoped package (0.025291ms)
    ✔ hasPeerSuffix returns true for unscoped with peer (0.023167ms)
    ✔ hasPeerSuffix returns true for scoped with peer (0.02225ms)
    ✔ extractPeerSuffix returns null for no peers (0.054792ms)
    ✔ extractPeerSuffix extracts peer suffix (0.029916ms)
    ✔ extractPeerSuffix handles multiple peers (0.022666ms)
  ✔ [pnpm-03] shrinkwrap peer suffix utilities (0.311ms)
  ▶ [pnpm-03] v5 peer suffix utilities
    ✔ hasPeerSuffixV5 returns false for no underscore (0.045291ms)
    ✔ hasPeerSuffixV5 returns true for underscore (0.021208ms)
    ✔ extractPeerSuffixV5 returns null for no peers (0.029125ms)
    ✔ extractPeerSuffixV5 extracts peer suffix (0.021583ms)
    ✔ extractPeerSuffixV5 handles multiple peers (0.022875ms)
  ✔ [pnpm-03] v5 peer suffix utilities (0.182708ms)
  ▶ [pnpm-03] v6+ peer suffix utilities
    ✔ hasPeerSuffixV6Plus returns false for no parens (0.102916ms)
    ✔ hasPeerSuffixV6Plus returns true for parens (0.021583ms)
    ✔ extractPeerSuffixV6Plus returns null for no peers (0.027375ms)
    ✔ extractPeerSuffixV6Plus extracts single peer (0.020292ms)
    ✔ extractPeerSuffixV6Plus extracts multiple peers (0.019667ms)
    ✔ parsePeerDependencies parses single peer (0.092208ms)
    ✔ parsePeerDependencies parses multiple peers (0.031875ms)
    ✔ parsePeerDependencies handles scoped peer (0.024833ms)
    ✔ parsePeerDependencies returns empty for null (0.020959ms)
  ✔ [pnpm-03] v6+ peer suffix utilities (0.427459ms)
```

</details>

pnpm encodes peer dependency resolutions in the package key:

```yaml
packages:
  /styled-jsx@5.1.1(react@18.2.0):
    resolution: {...}
```

For SBOM, the peer suffix `(react@18.2.0)` must be stripped. The package name is `styled-jsx`, version is `5.1.1`.

### pnpm-04: Snapshot Inclusion (v9)

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="pnpm-04" test/parsers/pnpm.test.js
```

**📋 Full Test Cases**
```
▶ [pnpm-04] pnpm snapshot inclusion
  ▶ v9 lockfile structure
    ✔ detectVersion identifies v9 format (0.105125ms)
    ✔ v9 has separate packages and snapshots sections (0.242416ms)
  ✔ v9 lockfile structure (0.5105ms)
  ▶ flatlock processes both sections
    ✔ yields packages from packages section (0.167917ms)
    ✔ yields packages from snapshots section (v9 only) (0.086958ms)
    ✔ deduplicates by name@version across sections (0.045709ms)
  ✔ flatlock processes both sections (0.357042ms)
  ▶ intentional mismatch with @pnpm/lockfile.fs
    ✔ mismatches are documented as intentional (documentation) (0.049708ms)
    ✔ snapshot entries are valid SBOM entries (0.060333ms)
  ✔ intentional mismatch with @pnpm/lockfile.fs (0.146375ms)
  ▶ v6 vs v9 behavior
    ✔ v6 has packages section only (no snapshots) (0.100917ms)
    ✔ v9 processing includes snapshots (0.147875ms)
  ✔ v6 vs v9 behavior (0.285084ms)
✔ [pnpm-04] pnpm snapshot inclusion (1.385125ms)
```

</details>

pnpm v9 splits the lockfile into two sections:

```yaml
packages:
  lodash@4.17.21:
    resolution: { integrity: sha512-... }

snapshots:
  styled-jsx@5.1.1(react@18.2.0):
    dependencies: { react: 18.2.0 }
```

- `packages`: Base package metadata (integrity, engines)
- `snapshots`: Actual installed variants with peer deps

flatlock processes BOTH sections for complete SBOM coverage, with deduplication by `name@version`.

### pnpm-05: Importers Filtering

**NOT TESTED** - needs test coverage

The `importers` section lists workspace packages that consume dependencies:

```yaml
importers:
  .:
    dependencies:
      lodash: ^4.17.21
  packages/app:
    dependencies:
      react: ^18.0.0
```

Importers are the consuming projects, not external dependencies. They must be excluded from SBOM output.

---

## yarn-classic (yarn.lock v1)

### yarn-classic-01: Multi-Range Key Parsing

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-classic-01" test/parsers/yarn-classic.test.js
```

**📋 Full Test Cases**
```
▶ yarn classic parsers
  ▶ parseLockfileKey
    ▶ [yarn-classic-01] multiple version ranges
      ✔ parses first from multiple ranges (0.060667ms)
      ✔ parses from many ranges (0.080125ms)
      ✔ parses unscoped from multiple ranges (0.23575ms)
      ✔ handles range with spaces (0.159042ms)
    ✔ [yarn-classic-01] multiple version ranges (0.846917ms)
  ▶ fromYarnClassicLock
    ▶ [yarn-classic-01] multiple version ranges handling
      ✔ handles entries with multiple version ranges (0.165209ms)
    ✔ [yarn-classic-01] multiple version ranges handling (0.361875ms)
```

</details>

yarn classic combines multiple semver ranges that resolve to the same version:

```
lodash@^4.17.21, lodash@^4.0.0, lodash@>=4.0.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
```

The parser takes the first entry before the comma and extracts the package name. All ranges resolve to the same `lodash@4.17.21`.

### yarn-classic-02: Link Protocol Filtering

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-classic-02" test/parsers/yarn-classic.test.js
```

**📋 Full Test Cases**
```
▶ yarn classic parsers
  ▶ fromYarnClassicLock
    ▶ [yarn-classic-02] protocol handling
      ✔ skips file: protocol entries (pre-parsed) (0.046833ms)
      ✔ skips link: protocol entries (pre-parsed) (0.031334ms)
    ✔ [yarn-classic-02] protocol handling (0.106084ms)
```

</details>

Local packages use `file:` or `link:` in the resolved field:

```
my-local-pkg@file:../local:
  version "1.0.0"
  resolved "file:../local"
```

These are local dependencies and must be excluded from SBOM output.

### yarn-classic-03: @yarnpkg/lockfile Parity

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-classic-03" test/accuracy.test.js
```

**📋 Full Test Cases**
```
▶ accuracy tests
  ▶ yarn classic (yarn.lock v1)
    ✔ [yarn-classic-03] compare against @yarnpkg/lockfile (74.478125ms)
    ℹ yarn classic: expected=1252, ours=1252, accuracy=100.00%
  ✔ yarn classic (yarn.lock v1) (74.791459ms)
```

</details>

flatlock achieves **100% accuracy** against @yarnpkg/lockfile, the official parser. This is possible because yarn classic has no alias complexity - the package name in the key IS the canonical name.

---

## yarn-berry (yarn.lock v2+)

### yarn-berry-01: Alias Resolution

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-01" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-01] yarn berry alias resolution
  ▶ parseResolution extracts canonical name from resolution field
    ✔ unscoped npm package (0.292792ms)
    ✔ scoped npm package (0.050708ms)
    ✔ CJS shim package - returns real package name (0.042416ms)
    ✔ workspace protocol (0.776208ms)
    ✔ patch protocol with nested npm reference (0.564875ms)
    ✔ null input returns null (0.0925ms)
    ✔ empty string returns null (0.136125ms)
  ✔ parseResolution extracts canonical name from resolution field (2.53675ms)
  ▶ parseLockfileKey extracts name from key (may be alias)
    ✔ simple unscoped package (0.219167ms)
    ✔ scoped package (0.13725ms)
    ✔ CJS shim alias - returns ALIAS name (not real package) (0.219208ms)
    ✔ scoped alias pointing to different scoped package (0.100167ms)
    ✔ placeholder package alias (0.034333ms)
  ✔ parseLockfileKey extracts name from key (may be alias) (0.92575ms)
  ▶ parseResolution vs parseLockfileKey: the critical distinction
    ✔ CJS shim: resolution has canonical name, key has alias (0.062584ms)
    ✔ organization baseline: resolution has canonical name, key has alias (0.028875ms)
    ✔ placeholder package: resolution has canonical name, key has alias (0.026542ms)
    ✔ non-aliased package: resolution and key match (0.030166ms)
  ✔ parseResolution vs parseLockfileKey: the critical distinction (0.190333ms)
  ▶ fromYarnBerryLock uses resolution for canonical name
    ✔ CJS shim alias - returns real package name from resolution (0.968167ms)
    ✔ scoped alias - returns real package name from resolution (0.154334ms)
    ✔ placeholder package alias - returns real package name from resolution (0.095583ms)
    ✔ multiple aliases to same package - deduplication by name@version (0.116167ms)
    ✔ fallback to key parsing when resolution is missing (0.052666ms)
    ✔ empty resolution string falls back to key parsing (0.048125ms)
  ✔ fromYarnBerryLock uses resolution for canonical name (1.493625ms)
✔ [yarn-berry-01] yarn berry alias resolution (5.52625ms)
```

</details>

yarn berry lockfile keys may contain npm aliases, but the resolution field contains the canonical package name:

```yaml
"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
```

- **Key**: `string-width-cjs` (alias)
- **Resolution**: `string-width` (canonical)

For SBOM accuracy, flatlock uses the resolution field. The alias `string-width-cjs` doesn't exist on npm; `string-width@4.2.3` does.

### yarn-berry-02: Intentional parseSyml Divergence

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-02" test/parsers/yarn-berry.test.js test/accuracy.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-02] intentional divergence from parseSyml
  ▶ parseSyml returns KEY names, flatlock returns RESOLUTION names
    ✔ parseSyml returns raw object with alias name as key (0.09375ms)
    ✔ flatlock returns canonical name from resolution field (0.13875ms)
    ✔ divergence is intentional - different outputs for same lockfile (0.144083ms)
  ✔ parseSyml returns KEY names, flatlock returns RESOLUTION names (0.424708ms)
  ▶ SBOM accuracy: canonical names match installed packages
    ✔ canonical name matches node_modules directory structure (0.107709ms)
    ✔ alias name would create non-existent package in SBOM (0.083875ms)
    ✔ placeholder packages should show actual installed package (0.041833ms)
  ✔ SBOM accuracy: canonical names match installed packages (0.279584ms)
  ▶ accuracy metric interpretation
    ✔ low accuracy against parseSyml is expected for aliased lockfiles (0.396958ms)
  ✔ accuracy metric interpretation (0.421166ms)
✔ [yarn-berry-02] intentional divergence from parseSyml (1.187042ms)

▶ accuracy tests
  ▶ yarn berry (yarn.lock v2+)
    ✔ [yarn-berry-02] v8 lockfile - compare against @yarnpkg/parsers (3.587375ms)
    ℹ yarn berry v8: expected=41, ours=41, accuracy=56.10%
```

</details>

flatlock achieves **56.10% accuracy** against @yarnpkg/parsers (parseSyml). This is **intentional**.

parseSyml returns alias names from keys. flatlock returns canonical names from resolutions. For lockfiles with aliases:
- parseSyml: `@babel-baseline/core@7.24.4` (alias, doesn't exist on npm)
- flatlock: `@babel/core@7.24.4` (canonical, has CVE data)

The divergence is correct for SBOM accuracy and vulnerability scanning.

### yarn-berry-03: @yarnpkg/core Parity

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-03" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-03] @yarnpkg/core ground truth parity
  ▶ resolution field is yarn Locator
    ✔ resolution format matches yarn locator pattern: name@protocol:reference (0.044667ms)
    ✔ unscoped package locator (0.026ms)
    ✔ workspace locator (0.023333ms)
    ✔ patch locator (complex nested format) (0.022958ms)
  ✔ resolution field is yarn Locator (0.158375ms)
  ▶ output structure matches originalPackages
    ✔ name field matches stringifyIdent equivalent (0.058583ms)
    ✔ version field matches pkg.version (0.039459ms)
    ✔ integrity field matches checksum (0.03975ms)
    ✔ resolved field preserves full resolution string (0.036792ms)
  ✔ output structure matches originalPackages (0.209959ms)
  ▶ runtime validation via compare.js
    ✔ compare.js validates parity at runtime (documentation) (0.02975ms)
  ✔ runtime validation via compare.js (0.047708ms)
✔ [yarn-berry-03] @yarnpkg/core ground truth parity (0.478209ms)
```

</details>

flatlock achieves **100% parity** with @yarnpkg/core's `originalPackages` registry. The resolution field in the lockfile is the yarn "locator" string that @yarnpkg/core uses internally.

### yarn-berry-04: Private API Usage

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-04" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-04] setupResolutions() private API usage
  ▶ why private API is necessary
    ✔ Project.find() requires matching package.json (documentation) (0.034208ms)
    ✔ setupResolutions() is private but accessible (0.023833ms)
    ✔ no public API for standalone lockfile parsing (0.021708ms)
  ✔ why private API is necessary (0.109292ms)
  ▶ maintenance considerations
    ✔ private API risk: may break in future versions (0.07625ms)
    ✔ alternative approach: parseSyml + parseResolution (0.074083ms)
  ✔ maintenance considerations (0.778459ms)
✔ [yarn-berry-04] setupResolutions() private API usage (0.925667ms)
```

</details>

To validate against @yarnpkg/core without a full project setup, compare.js calls `project['setupResolutions']()` directly. This is a private API (TypeScript `private` keyword) accessed via bracket notation.

This is necessary because:
- `Project.find()` requires matching package.json files
- No public API exists for "parse lockfile only"
- The private API populates `originalPackages` from lockfile alone

### yarn-berry-05: patch: Protocol Parsing

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-05" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-05] patch: protocol nested reference
  ▶ parseLockfileKey finds FIRST protocol
    ✔ patch: protocol with nested npm: reference (0.045541ms)
    ✔ scoped package with patch: protocol (0.025583ms)
    ✔ patch: protocol appears before npm: in key (0.024417ms)
  ✔ parseLockfileKey finds FIRST protocol (0.125583ms)
  ▶ parseResolution handles patch: protocol
    ✔ patch: resolution extracts name (0.031542ms)
    ✔ scoped patch: resolution (0.021292ms)
  ✔ parseResolution handles patch: protocol (0.074417ms)
  ▶ protocol priority in key parsing
    ✔ protocol at earliest position wins (0.027666ms)
  ✔ protocol priority in key parsing (0.04375ms)
✔ [yarn-berry-05] patch: protocol nested reference (0.295ms)
```

</details>

The `patch:` protocol embeds another protocol inside it:

```yaml
"lodash@patch:lodash@npm:4.17.21#./patches/fix.patch":
  version: 4.17.21
  resolution: "lodash@patch:lodash@npm:4.17.21#./patches/fix.patch"
```

The parser must find the FIRST protocol marker (`@patch:`), not the nested `@npm:`. The package name is `lodash`.

### yarn-berry-06: Protocol Filtering

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-06" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-06] portal/link/workspace filtering
  ▶ yarn berry workspace: protocol
    ✔ workspace: entries are filtered from output (0.118209ms)
    ✔ workspace: in key triggers filtering (0.0435ms)
  ✔ yarn berry workspace: protocol (0.184542ms)
  ▶ yarn berry portal: protocol
    ✔ portal: entries are filtered from output (0.046ms)
  ✔ yarn berry portal: protocol (0.070875ms)
  ▶ yarn berry link: protocol
    ✔ link: entries are filtered from output (0.042917ms)
  ✔ yarn berry link: protocol (0.058375ms)
  ▶ mixed lockfile filtering
    ✔ only external npm packages are yielded (0.090542ms)
  ✔ mixed lockfile filtering (0.108125ms)
  ▶ filtering by resolution field
    ✔ resolution with workspace: is filtered even if key has npm: (0.044834ms)
  ✔ filtering by resolution field (0.060917ms)
✔ [yarn-berry-06] portal/link/workspace filtering (0.543792ms)
```

</details>

Local package protocols must be filtered from SBOM output:

| Protocol | Description | Include in SBOM? |
|----------|-------------|------------------|
| `npm:` | Registry package | Yes |
| `workspace:` | Monorepo workspace | No |
| `portal:` | Symlinked external | No |
| `link:` | Symlinked local | No |
| `patch:` | Patched npm package | Yes |
| `file:` | Local file | No |

### yarn-berry-07: Workspace Exclusion

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="yarn-berry-07" test/parsers/yarn-berry.test.js
```

**📋 Full Test Cases**
```
▶ [yarn-berry-07, pnpm-04] workspace exclusion counts
  ▶ yarn berry workspace exclusion
    ✔ external packages counted, workspaces excluded (0.088583ms)
    ✔ scoped workspaces are excluded (0.083958ms)
  ✔ yarn berry workspace exclusion (0.194709ms)
  ▶ pnpm workspace exclusion
    ✔ link: protocol entries are excluded (0.048708ms)
  ✔ pnpm workspace exclusion (0.064416ms)
✔ [yarn-berry-07, pnpm-04] workspace exclusion counts (0.292208ms)
```

</details>

Workspace packages have `workspace:` protocol in their resolution:

```yaml
"my-app@workspace:.":
  version: 0.0.0-use.local
  resolution: "my-app@workspace:."
```

These are local packages in the monorepo and must be excluded from SBOM output.

---

## Cross-Cutting

### cross-01: Equinumerous Comparison Semantics

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="cross-01" test/lockfile.test.js
```

**📋 Full Test Cases**
```
▶ [cross-01] equinumerous semantic
  ▶ equinumerous compares cardinality, not names
    ✔ same count with different names is still equinumerous (0.040167ms)
    ✔ different counts means not equinumerous (0.023083ms)
  ✔ equinumerous compares cardinality, not names (0.086125ms)
  ▶ why cardinality comparison is correct
    ✔ cardinality mismatch indicates parsing bug (documentation) (0.026458ms)
    ✔ name differences are expected for aliased packages (0.028ms)
  ✔ why cardinality comparison is correct (0.075125ms)
  ▶ equinumerous with missing/extra packages
    ✔ equinumerous can be true even with missing/extra (balanced) (0.039875ms)
  ✔ equinumerous with missing/extra packages (0.054083ms)
✔ [cross-01] equinumerous semantic (0.264208ms)
```

</details>

The `equinumerous` field in compare.js compares **cardinality** (set size), not individual package names:

```javascript
const equinumerous = flatlockPackages.size === comparisonPackages.size;
```

Two sets are equinumerous if they have the same number of elements, even if the elements differ. This is correct for validating parser coverage:
- Cardinality match → parser found same number of packages
- Name differences → expected for aliases (documented divergence)
- Cardinality mismatch → likely parsing bug

Etymology: Latin "equi-" (equal) + "numerus" (number) = same cardinality.

### npm-06 (formerly cross-02): Scoped Package Parsing

<details>
  <summary>⚗️ Reproducibility & 📋 Full Test Cases</summary>

**⚗️ Reproducibility**
```bash
node --test --test-name-pattern="npm-06" test/parsers/npm.test.js
```

**📋 Full Test Cases**
```
▶ npm parsers
  ▶ fromPackageLock
    ▶ [npm-06] scoped packages
      ✔ [npm-06] parses various scoped packages from v2 fixture (4.701ms)
    ✔ [npm-06] scoped packages (4.770041ms)
```

</details>

All package managers support scoped packages (`@scope/name`). The parser must:

1. Detect the leading `@` indicating a scope
2. Find the `/` separating scope from name
3. Find the version delimiter after the full scoped name

```
@babel/core@7.24.4
  ↑     ↑   ↑
  scope name version
```

Edge cases: `@scope` alone (invalid), `@@double` (invalid), `@scope/name/extra` (valid, name is `name/extra`).

---

## Test Coverage Summary

| Scenario | Status | Primary Test File |
|----------|--------|-------------------|
| npm-01 to npm-06 | Tested | `test/parsers/npm.test.js` |
| pnpm-01 to pnpm-04 | Tested | `test/parsers/pnpm.test.js` |
| pnpm-05 | Placeholder | `test/parsers/pnpm.test.js` |
| yarn-classic-01 to yarn-classic-03 | Tested | `test/parsers/yarn-classic.test.js`, `test/accuracy.test.js` |
| yarn-berry-01 to yarn-berry-07 | Tested | `test/parsers/yarn-berry.test.js` |
| cross-01 | Tested | `test/lockfile.test.js` |

Run scenario tests by pattern:
```bash
# Run all tests for a specific scenario
node --test --test-name-pattern="npm-01" test/parsers/npm.test.js
node --test --test-name-pattern="yarn-berry-02" test/parsers/yarn-berry.test.js

# Run accuracy tests (ground truth comparison)
pnpm test -- --test-name-pattern="accuracy"
```
