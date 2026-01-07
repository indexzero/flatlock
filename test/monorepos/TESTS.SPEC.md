# Monorepo SBOM Tests Specification

## 1. Purpose

These tests validate that `FlatlockSet.dependenciesOf()` produces accurate per-workspace SBOMs from monorepo lockfiles. The reference implementation is CycloneDX.

**Scope**: Workspace-specific dependency traversal.

**Out of scope**: Total lockfile parsing (test/compare.test.js), parser correctness (test/parsers/), FlatlockSet operations (test/set.test.js).

## 2. Definitions

| Term | Definition |
|------|------------|
| **Workspace** | A package within a monorepo, identified by path relative to root |
| **SBOM** | Software Bill of Materials - list of packages in a dependency tree |
| **Reference (C)** | Set of packages from CycloneDX for a workspace |
| **Test (F)** | Set of packages from flatlock.dependenciesOf() for a workspace |
| **Missing** | C - F, packages in reference but not in test |
| **Extra** | F - C, packages in test but not in reference |
| **Superset** | F contains every element in C |

## 3. Test Structure

### 3.1 File Organization

```
test/monorepos/
  TESTS.SPEC.md           # This specification
  README.md               # Documentation and tutorials
  monorepos.test.js       # Fixture-based tests

  fixtures/
    {pm}/                 # npm, pnpm, yarn-berry, yarn-classic
      {owner-repo}/
        {lockfile}        # package-lock.json, pnpm-lock.yaml, yarn.lock
        package.json      # Root package.json
        metadata.json     # Fixture metadata
        {workspace}/
          package.json    # Workspace package.json
        references/
          {workspace}.json  # CycloneDX output for workspace
```

### 3.2 Test Hierarchy

```javascript
describe('{package-manager} monorepos', () => {
  describe('{owner/repo}', () => {
    it('{workspace}: dependenciesOf matches CycloneDX', () => {});
  });
});
```

### 3.3 Fixture Format

**metadata.json**:
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "type": "npm|pnpm|yarn-berry|yarn-classic",
  "fetchedAt": "YYYY-MM-DD",
  "lockfileVersion": "version",
  "workspaces": ["path/to/ws1", "path/to/ws2"],
  "testWorkspaces": ["path/to/ws1"]
}
```

**references/{workspace}.json**: Raw CycloneDX JSON output.

## 4. Test Matrix

See README.md for the full matrix. Each entry follows:

| Field | Requirement |
|-------|-------------|
| Package manager | npm, pnpm, yarn-berry, or yarn-classic |
| Repository | Public GitHub repository |
| Branch | Existing branch with lockfile |
| Workspaces | 3-5 workspaces per repository |

### 4.1 Matrix Entry Validity

A matrix entry is valid when:
- Repository exists and is publicly accessible
- Branch exists and contains lockfile at root
- Each workspace directory contains package.json with `name` and `version`
- CycloneDX can generate SBOM for each workspace

## 5. Success Criteria

### 5.1 Pass Condition

```
C = reference set (CycloneDX)
F = test set (flatlock)

PASS if and only if: C is a subset of F
                     (every package in C is also in F)
```

Equivalently: `|C - F| = 0`

### 5.2 Failure Condition

```
FAIL if: |C - F| > 0 (flatlock missing packages)
```

### 5.3 Warnings

Extra packages (|F - C| > 0) do not cause failure. Log for review:

```
Extra in flatlock (N): pkg1@1.0.0, pkg2@2.0.0, ...
```

### 5.4 Rationale

For security scanning:
- **False negatives (missing packages)**: Dangerous. Vulnerabilities go undetected.
- **False positives (extra packages)**: Safe. Worst case: extra work reviewing.

## 6. Reference Command

CycloneDX reference is generated with:

```bash
npx @cyclonedx/cyclonedx-npm \
  -w {workspace} \
  --output-format JSON \
  --flatten-components \
  --omit dev
```

Corresponding flatlock call:

```javascript
lockfile.dependenciesOf(workspacePkg, {
  workspacePath: workspace,
  dev: false
});
```

### 6.1 Package Key Format

Both reference and test sets use `{name}@{version}` as package keys.

For scoped packages, CycloneDX uses `group` and `name` separately:
```
group: "@types", name: "node" -> @types/node
```

Self-reference (the workspace package itself) is excluded from both sets.

## 7. Error Handling

### 7.1 Network Errors (live mode)

| Error | Response |
|-------|----------|
| git clone timeout | Skip test: "network timeout" |
| Repository not found | Fail test: "repository not found: {repo}" |
| Branch not found | Fail test: "branch not found: {branch}" |
| Install timeout | Skip test: "install timeout" |
| Install failure | Fail test with stderr |

### 7.2 Fixture Errors

| Error | Response |
|-------|----------|
| Lockfile not found | Skip test: "lockfile not found" |
| Workspace not found | Fail test: "workspace not found: {path}" |
| Invalid package.json | Fail test: "invalid package.json: {path}" |
| Reference missing | Skip test: "reference not found: {workspace}" |

### 7.3 Tool Errors

| Error | Response |
|-------|----------|
| CycloneDX not available | Skip live tests: "CycloneDX not installed" |
| CycloneDX failure | Fail test with stderr |
| CycloneDX invalid JSON | Fail test: "invalid CycloneDX output" |

### 7.4 Resource Errors

| Error | Response |
|-------|----------|
| Disk full | Abort all tests |
| Timeout exceeded | Fail test: "timeout after {duration}ms" |

## 8. Timeouts

### 8.1 Fixture Mode

| Operation | Timeout |
|-----------|---------|
| Load fixture | 5s |
| Parse lockfile | 10s |
| dependenciesOf | 10s |
| **Total per test** | **30s** |

### 8.2 Live Mode

| Operation | Default | Maximum |
|-----------|---------|---------|
| git clone | 60s | 300s |
| npm install | 300s | 900s |
| pnpm install | 180s | 600s |
| yarn install | 240s | 900s |
| CycloneDX | 120s | 300s |
| **Total per test** | **600s** | **1800s** |

### 8.3 Configuration

```bash
# Environment variable
FLATLOCK_TEST_TIMEOUT=600000

# Node.js test runner
node --test --test-timeout=600000
```

## 9. Security Model

### 9.1 Threat

Supply chain attacks via install scripts (postinstall, preinstall, prepare).

### 9.2 Mitigation

All package manager operations disable scripts:

| Manager | Configuration |
|---------|---------------|
| npm | `.npmrc`: `ignore-scripts=true` |
| pnpm | `.pnpmrc`: `ignore-scripts=true` |
| yarn berry | `.yarnrc.yml`: `enableScripts: false` |

Additional npm flags:
```
audit=false
fund=false
```

### 9.3 Tradeoffs

Some packages require postinstall (native modules, binary downloads). Tests may not reflect exact production dependency trees for such packages. This is acceptable: security takes precedence over completeness in the test environment.

## 10. Invariants

Properties that must always hold:

1. **Security**: No untrusted code executes during test setup
2. **Isolation**: Tests do not affect each other's state
3. **Cleanup**: Temporary directories are removed after test completion
4. **Determinism**: Same fixture produces same result (fixture mode)
5. **Completeness**: Reference set is always subset of test set (C is a subset of F)

## 11. Diagnostic Output

### 11.1 Pass

```
{workspace}: dependenciesOf matches CycloneDX
  flatlock:  142 packages
  cyclonedx: 138 packages
  extra:     4 (vue-demi@0.14.0, ...)
  missing:   0
```

### 11.2 Fail

```
{workspace}: dependenciesOf matches CycloneDX
  flatlock:  135 packages
  cyclonedx: 138 packages
  extra:     0
  missing:   3 (lodash@4.17.21, ...)
  FAIL: flatlock missing 3 packages: lodash@4.17.21, ...
```

## 12. References

- `test/monorepos/README.md` - Documentation and test matrix
- `test/support/monorepo.js` - Shared utilities
- `test/support/{npm,pnpm,yarn}.js` - Package manager utilities
- `bin/fetch-monorepo-manifests.js` - Fixture generation tool
- CycloneDX npm: https://github.com/CycloneDX/cyclonedx-node-npm
