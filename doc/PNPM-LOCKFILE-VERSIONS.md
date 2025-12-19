# pnpm Lockfile Format Evolution: A Sequential Analysis

This document traces the evolution of pnpm's lockfile format from its inception to the current version, analyzing each major change systematically.

---

## Sequential Thinking Process

### Step 1: Establish the Timeline

| Era | pnpm Version | Lockfile Version | File Name | Date |
|-----|--------------|------------------|-----------|------|
| Pre-v3 | v1.x - v2.x | shrinkwrapVersion 3, 3.9, 4 | `shrinkwrap.yaml` | 2016-2019 |
| v3 Era | v3.0.0+ | 5.0, 5.1 | `pnpm-lock.yaml` | Feb 2019 |
| v5-v6 Era | v5.10+, v6.x | 5.2, 5.3 | `pnpm-lock.yaml` | 2020-2021 |
| v7 Era | v7.x | 5.4, 5.4-inlineSpecifiers | `pnpm-lock.yaml` | 2022 |
| v8 Era | v8.x | 6.0 | `pnpm-lock.yaml` | 2023 |
| v9 Era | v9.x | 9.0 | `pnpm-lock.yaml` | 2024 |
| v10 Era | v10.x | 9.0 (unchanged) | `pnpm-lock.yaml` | 2025 |

---

### Step 2: Shrinkwrap Era (v1-v2, 2016-2019)

**File:** `shrinkwrap.yaml`  
**Private file:** `node_modules/.shrinkwrap.yaml`

#### shrinkwrapVersion 3 / 3.9 / 4

```yaml
shrinkwrapVersion: 3
registry: https://registry.npmjs.org/
dependencies:
  lodash: 4.17.21
packages:
  /lodash/4.17.21:
    resolution:
      integrity: sha512-...
    dev: false
```

**Key characteristics:**
- Package paths used `/name/version` format (slash separator)
- Scoped packages: `/@scope/name/version`
- Peer dependency suffix: `/<peer specs...>` with `!` escaping scopes
  - Example: `/foo/1.0.0/bar@2.0.0+@scope!qar@3.0.0`
- Simple dependency mapping: `name: version`
- No workspace support
- `specifiers` not yet introduced

---

### Step 3: Lockfile v5.0 (pnpm v3.0.0, Feb 2019)

**Breaking change:** Renamed file from `shrinkwrap.yaml` to `pnpm-lock.yaml`

```yaml
lockfileVersion: 5
packages:
  /lodash/4.17.21:
    resolution:
      integrity: sha512-...
    dev: false
```

**Changes from shrinkwrap v3/4:**
- File renamed to `pnpm-lock.yaml`
- Peer dependency suffix changed from `/` to `_` separator
  - Old: `/foo/1.0.0/bar@2.0.0`
  - New: `/foo/1.0.0_bar@2.0.0`
- Scoped peer dependencies escaped with `+` instead of `!`
  - Old: `@scope!qar@3.0.0`
  - New: `@scope+qar@3.0.0`
- lockfileVersion is a **number** (not quoted)

---

### Step 4: Lockfile v5.1 (pnpm v3.5.0, Jun 2019)

Minor format refinements. Structure remains similar to 5.0.

---

### Step 5: Lockfile v5.2 (pnpm v5.10.0, Oct 2020)

```yaml
lockfileVersion: 5.2
importers:
  .:
    specifiers:
      lodash: ^4.17.21
    dependencies:
      lodash: 4.17.21
packages:
  /lodash/4.17.21:
    resolution:
      integrity: sha512-...
```

**Changes:**
- Subdependencies can have linked dependencies (relative paths)
- Peer dependencies with same name as package are ignored
- `importers` section introduced for workspace support
- `specifiers` block added (separate from resolved versions)

---

### Step 6: Lockfile v5.3 (pnpm v6.0.0, Feb 2021)

```yaml
lockfileVersion: 5.3
importers:
  .:
    specifiers:
      lodash: ^4.17.21
    dependencies:
      lodash: 4.17.21
  packages/foo:
    specifiers:
      react: ^17.0.0
    dependencies:
      react: 17.0.2
packages:
  /lodash/4.17.21:
    resolution:
      integrity: sha512-...
```

**Changes:**
- Full workspace support via `importers`
- Each importer has its own `specifiers` block
- Package paths still use `/name/version` format

---

### Step 7: Lockfile v5.4 (pnpm v7.0.0, 2022)

```yaml
lockfileVersion: 5.4
importers:
  .:
    specifiers:
      lodash: ^4.17.21
    dependencies:
      lodash: 4.17.21
packages:
  /lodash/4.17.21:
    resolution:
      integrity: sha512-...
```

**Changes:**
- Lockfile format same as 5.3 for v6/v7 compatibility
- Internal improvements
- Still uses `_` for peer dependency suffixes:
  - `/webpack-cli/4.10.0_fzn43tb6bdtdxy2s3aqevve2su`

---

### Step 8: Lockfile v5.4-inlineSpecifiers (pnpm v7.7.0, Experimental)

```yaml
lockfileVersion: 5.4-inlineSpecifiers
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
```

**Experimental change:**
- Removed separate `specifiers` block
- Specifier inlined next to version in each dependency entry
- Reduces merge conflicts when dependencies on adjacent lines change
- This was a preview of what became v6.0

---

### Step 9: Lockfile v6.0 (pnpm v8.0.0, 2023)

**Major structural changes**

```yaml
lockfileVersion: '6.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
    devDependencies:
      typescript:
        specifier: ^5.0.0
        version: 5.3.3
packages:
  /lodash@4.17.21:
    resolution:
      integrity: sha512-...
  /webpack-cli@4.10.0(webpack@5.89.0):
    resolution:
      integrity: sha512-...
    peerDependencies:
      webpack: ^5.0.0
    dependencies:
      webpack: 5.89.0
```

**Breaking changes:**

1. **lockfileVersion is now a STRING** (quoted `'6.0'`)

2. **Package key format changed:**
   - Old (v5): `/lodash/4.17.21`
   - New (v6): `/lodash@4.17.21`
   - Uses `@` separator instead of `/`

3. **Peer dependency suffix format:**
   - Old (v5): `/webpack-cli/4.10.0_fzn43tb6bdtdxy2s3aqevve2su` (underscore + hash)
   - New (v6): `/webpack-cli@4.10.0(webpack@5.89.0)` (parentheses, readable)

4. **Inline specifiers (from experimental):**
   - `specifiers` block removed
   - Each dependency has `specifier` and `version` inline

5. **New `settings` section:**
   - Records pnpm configuration that affects resolution
   - `autoInstallPeers`, `excludeLinksFromLockfile`, etc.

---

### Step 10: Lockfile v9.0 (pnpm v9.0.0, 2024)

**Major architectural change: packages/snapshots split**

```yaml
lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
    devDependencies:
      ts-api-utils:
        specifier: ^1.0.0
        version: 1.2.1(typescript@5.3.3)

packages:
  lodash@4.17.21:
    resolution:
      integrity: sha512-...
    engines:
      node: '>=4'
  
  ts-api-utils@1.2.1:
    resolution:
      integrity: sha512-...
    engines:
      node: '>=16'
    peerDependencies:
      typescript: '>=4.2.0'
  
  typescript@5.3.3:
    resolution:
      integrity: sha512-...
    engines:
      node: '>=14.17'
    hasBin: true

snapshots:
  lodash@4.17.21: {}
  
  ts-api-utils@1.2.1(typescript@5.3.3):
    dependencies:
      typescript: 5.3.3
  
  typescript@5.3.3: {}
```

**Breaking changes:**

1. **Package keys no longer have leading slash:**
   - Old (v6): `/lodash@4.17.21`
   - New (v9): `lodash@4.17.21`

2. **Split `packages` into `packages` + `snapshots`:**
   - `packages`: Package **metadata** (resolution, integrity, engines, peerDependencies)
   - `snapshots`: Dependency **relationships** (dependencies, optionalDependencies, dev flag)

3. **Deduplication benefit:**
   - In v6, same package with different peers was duplicated entirely
   - In v9, metadata in `packages` appears once; multiple entries in `snapshots` for peer variants
   
   ```yaml
   # v6 had duplication:
   packages:
     /ts-api-utils@1.2.1(typescript@4.9.5):
       resolution: {integrity: ...}  # duplicated
       engines: {node: '>=16'}       # duplicated
       peerDependencies: {...}       # duplicated
       dependencies:
         typescript: 4.9.5
     /ts-api-utils@1.2.1(typescript@5.3.3):
       resolution: {integrity: ...}  # same as above
       engines: {node: '>=16'}       # same as above
       peerDependencies: {...}       # same as above
       dependencies:
         typescript: 5.3.3
   
   # v9 deduplicates:
   packages:
     ts-api-utils@1.2.1:
       resolution: {integrity: ...}
       engines: {node: '>=16'}
       peerDependencies:
         typescript: '>=4.2.0'
   snapshots:
     ts-api-utils@1.2.1(typescript@4.9.5):
       dependencies:
         typescript: 4.9.5
     ts-api-utils@1.2.1(typescript@5.3.3):
       dependencies:
         typescript: 5.3.3
   ```

---

### Step 11: pnpm v10 (2025)

**No lockfile version change** - still uses `lockfileVersion: '9.0'`

```yaml
lockfileVersion: '9.0'
# Structure identical to v9
```

**Related changes (not in lockfile version):**
- SHA256 hashing for long peer dependency paths (was MD5)
- SHA256 for `packageExtensionsChecksum` field
- Store version bumped to v10
- Conversion from v6 → v9 removed (must use pnpm v9 first)

---

## Summary: Key Format Changes by Version

| Version | Package Key | Peer Suffix | Specifiers | Type |
|---------|-------------|-------------|------------|------|
| 3/4 | `/name/version` | `/peer@ver` with `!` | N/A | number |
| 5.x | `/name/version` | `_peer@ver` with `+` | Separate block | number |
| 6.0 | `/name@version` | `(peer@ver)` | Inline | string |
| 9.0 | `name@version` | `(peer@ver)` in snapshots | Inline | string |

---

## Parsing Considerations

### Detecting Version

```javascript
function detectLockfileVersion(content) {
  const lockfile = yaml.load(content)
  const version = lockfile.lockfileVersion || lockfile.shrinkwrapVersion
  
  if (typeof version === 'number') {
    // v5.x or earlier
    return { era: 'v5', version }
  }
  
  if (typeof version === 'string') {
    if (version.startsWith('9')) return { era: 'v9', version }
    if (version.startsWith('6')) return { era: 'v6', version }
    if (version.includes('inlineSpecifiers')) return { era: 'v5-inline', version }
  }
  
  return { era: 'unknown', version }
}
```

### Parsing Package Keys

```javascript
function parsePackageKey(key, lockfileVersion) {
  // Remove leading slash if present (v5, v6)
  const normalized = key.startsWith('/') ? key.slice(1) : key
  
  // Strip peer suffix
  let withoutPeers = normalized
  if (lockfileVersion >= 6) {
    // v6+: parentheses format
    const parenIndex = normalized.indexOf('(')
    if (parenIndex !== -1) {
      withoutPeers = normalized.slice(0, parenIndex)
    }
  } else {
    // v5: underscore format
    const underscoreIndex = normalized.indexOf('_')
    if (underscoreIndex !== -1) {
      withoutPeers = normalized.slice(0, underscoreIndex)
    }
  }
  
  // Find name/version split
  if (lockfileVersion >= 6) {
    // v6+: name@version format
    const atIndex = withoutPeers.lastIndexOf('@')
    return {
      name: withoutPeers.slice(0, atIndex),
      version: withoutPeers.slice(atIndex + 1)
    }
  } else {
    // v5: name/version format
    const lastSlash = withoutPeers.lastIndexOf('/')
    return {
      name: withoutPeers.slice(0, lastSlash),
      version: withoutPeers.slice(lastSlash + 1)
    }
  }
}
```

---

## References

- [pnpm/spec repository](https://github.com/pnpm/spec/tree/master/lockfile)
- [Lockfile v9 RFC (Issue #7685)](https://github.com/pnpm/pnpm/issues/7685)
- [Inline specifiers PR (#5091)](https://github.com/pnpm/pnpm/pull/5091)
- [Lockfile Explorer Documentation](https://lfx.rushstack.io/pages/concepts/pnpm_lockfile/)
- [pnpm v10 Release Notes](https://github.com/pnpm/pnpm/releases/tag/v10.0.0)
