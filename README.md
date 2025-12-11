# `flatlock`

The Matlock of lockfile parsers - cuts through the complexity to get just the facts. Flat lockfile parser that extracts packages without building dependency graphs.

## What makes `flatlock` different?

![matlockish](./doc/matlockish.png)

Most lockfile parsers (like `@npmcli/arborist` or `snyk-nodejs-lockfile-parser`) build the full dependency graph with edges representing relationships between packages. This is necessary for dependency resolution but overkill for many use cases.

**flatlock** takes a different approach: it extracts a flat stream of packages from any lockfile format. No trees, no graphs, no edges - just packages.

```javascript
import * as `flatlock`from 'flatlock';

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

## License

Apache-2.0
