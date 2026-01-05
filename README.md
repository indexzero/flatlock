# `flatlock`

The Matlock of lockfile parsers - cuts through the complexity to get just the facts. Flat lockfile parser that extracts packages without building dependency graphs.

## What makes `flatlock` different?

![matlockish](https://github.com/indexzero/flatlock/raw/main/doc/img/matlockish.png)

Most lockfile parsers (like `@npmcli/arborist` or `snyk-nodejs-lockfile-parser`) build the full dependency graph with edges representing relationships between packages. This is necessary for dependency resolution but overkill for many use cases.

**flatlock** takes a different approach: it extracts a flat stream of packages from any lockfile format. No trees, no graphs, no edges - just packages.

```javascript
import * as flatlock from 'flatlock';

// Stream packages from any lockfile
for await (const pkg of flatlock.fromPath('./package-lock.json')) {
  console.log(pkg.name, pkg.version, pkg.integrity);
}
```

## When to use flatlock

| Use Case               | Needs Graph? | Use flatlock?    |
|------------------------|--------------|------------------|
| SBOM generation        | No           | Yes              |
| Vulnerability scanning | No           | Yes              |
| License compliance     | No           | Yes              |
| Integrity verification | No           | Yes              |
| Package enumeration    | No           | Yes              |
| Dependency resolution  | Yes          | No, use Arborist |
| "Why is X installed?"  | Yes          | No, use Arborist |

## Supported Formats

- **npm**: package-lock.json (v1, v2, v3)
- **pnpm**: pnpm-lock.yaml (v5.4, v6, v9)
- **yarn classic**: yarn.lock v1
- **yarn berry**: yarn.lock v2+

## API

```javascript
import * as flatlock from 'flatlock';

// Auto-detect format from file
for await (const pkg of flatlock.fromPath('./pnpm-lock.yaml')) { }

// Parse string content (sync generator)
for (const pkg of flatlock.fromString(content, { path: 'yarn.lock' })) { }

// Format-specific parsers
for (const pkg of flatlock.fromPackageLock(content)) { }
for (const pkg of flatlock.fromPnpmLock(content)) { }
for (const pkg of flatlock.fromYarnLock(content)) { }  // auto-detects v1 vs v2+
for (const pkg of flatlock.fromYarnClassicLock(content)) { }
for (const pkg of flatlock.fromYarnBerryLock(content)) { }

// Error handling with Result type
const result = flatlock.tryFromPath('./package-lock.json');
if (result.ok) {
  for await (const pkg of result.value) { }
}

// Collect all packages into array
const packages = await flatlock.collect('./package-lock.json');

// Type detection
const type = flatlock.detectType({ path: 'yarn.lock', content });
console.log(type); // 'yarn-classic' or 'yarn-berry'

// Content-only detection (path is optional)
flatlock.detectType({ content }); // auto-detect from content alone

// Type constants
console.log(flatlock.Type.NPM); // 'npm'
```

## Output Format

Each yielded package has:

```typescript
{
  name: string;      // Package name (e.g., "@babel/core")
  version: string;   // Resolved version (e.g., "7.23.0")
  integrity?: string; // Integrity hash (sha512, sha384, sha256, sha1)
  resolved?: string;  // Download URL
}
```

## FlatlockSet

For more advanced use cases, `FlatlockSet` provides Set-like operations on lockfile dependencies:

```javascript
import { FlatlockSet } from 'flatlock';

// Create from lockfile
const set = await FlatlockSet.fromPath('./package-lock.json');
console.log(set.size); // 1234
console.log(set.has('lodash@4.17.21')); // true

// Set operations (immutable - return new sets)
const other = await FlatlockSet.fromPath('./other-lock.json');
const common = set.intersection(other);  // packages in both
const added = other.difference(set);     // packages only in other
const all = set.union(other);            // packages in either

// Predicates
set.isSubsetOf(other);    // true if all packages in set are in other
set.isSupersetOf(other);  // true if set contains all packages in other
set.isDisjointFrom(other); // true if no packages in common

// Iterate like a Set
for (const dep of set) {
  console.log(dep.name, dep.version);
}
```

### Workspace-Specific SBOMs

For monorepos, use `dependenciesOf()` to get only the dependencies of a specific workspace:

```javascript
import { readFile } from 'node:fs/promises';
import { FlatlockSet } from 'flatlock';

const lockfile = await FlatlockSet.fromPath('./package-lock.json');
const pkg = JSON.parse(await readFile('./packages/api/package.json', 'utf8'));

// Get only dependencies reachable from this workspace
const subset = lockfile.dependenciesOf(pkg, {
  workspacePath: 'packages/api',  // for correct resolution in monorepos
  dev: false,                      // exclude devDependencies
  optional: true,                  // include optionalDependencies
  peer: false                      // exclude peerDependencies
});

console.log(`${pkg.name} has ${subset.size} production dependencies`);
```

**Note:** Sets created via `union()`, `intersection()`, or `difference()` cannot use `dependenciesOf()` because they lack the raw lockfile data needed for traversal. Check `set.canTraverse` before calling.

## License

Apache-2.0
