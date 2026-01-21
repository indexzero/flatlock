#!/usr/bin/env node
/**
 * flatcover - Check lockfile package coverage against a registry
 *
 * Checks if packages from a lockfile exist in a npm registry.
 * Outputs CSV by default: package,version,present
 *
 * Usage:
 *   flatcover <lockfile> --cover                              # check against npmjs.org
 *   flatcover <lockfile> --cover --registry <url>             # custom registry
 *   flatcover <lockfile> --cover --registry <url> --auth u:p  # with basic auth
 *   flatcover <lockfile> --cover --ndjson                     # streaming output
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { Pool, RetryAgent } from 'undici';
import { FlatlockSet } from '../src/set.js';

const { values, positionals } = parseArgs({
  options: {
    workspace: { type: 'string', short: 'w' },
    list: { type: 'string', short: 'l' },
    dev: { type: 'boolean', default: false },
    peer: { type: 'boolean', default: true },
    specs: { type: 'boolean', short: 's', default: false },
    json: { type: 'boolean', default: false },
    ndjson: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    cover: { type: 'boolean', default: false },
    registry: { type: 'string', default: 'https://registry.npmjs.org' },
    auth: { type: 'string' },
    token: { type: 'string' },
    concurrency: { type: 'string', default: '20' },
    progress: { type: 'boolean', default: false },
    summary: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  },
  allowPositionals: true
});

// Check if stdin input is requested via '-' positional argument (Unix convention)
const useStdin = positionals[0] === '-';

// Determine if we have a valid input source
const hasInputSource = positionals.length > 0 || values.list;

if (values.help || !hasInputSource) {
  console.log(`flatcover - Check lockfile package coverage against a registry

Usage:
  flatcover <lockfile> --cover
  flatcover --list packages.json --cover
  cat packages.ndjson | flatcover - --cover
  flatcover <lockfile> --cover --registry <url> --auth user:pass

Input sources (mutually exclusive):
  <lockfile>              Parse lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock)
  -l, --list <file>       Read JSON array of {name, version} objects from file
  -                       Read NDJSON {name, version} objects from stdin (one per line)

Options:
  -w, --workspace <path>  Workspace path within monorepo (lockfile mode only)
  -s, --specs             Include version (name@version or {name,version})
  --json                  Output as JSON array
  --ndjson                Output as newline-delimited JSON (streaming)
  --full                  Include all metadata (integrity, resolved)
  --dev                   Include dev dependencies (default: false)
  --peer                  Include peer dependencies (default: true)
  -h, --help              Show this help

Coverage options:
  --cover                 Enable registry coverage checking
  --registry <url>        Registry URL (default: https://registry.npmjs.org)
  --auth <user:pass>      Basic authentication credentials
  --token <token>         Bearer token for authentication
  --concurrency <n>       Concurrent requests (default: 20)
  --progress              Show progress on stderr
  --summary               Show coverage summary on stderr

Output formats (with --cover):
  (default)               CSV: package,version,present
  --full                  CSV: package,version,present,integrity,resolved
  --json                  [{"name":"...","version":"...","present":true}, ...]
  --full --json           Adds "integrity" and "resolved" fields to JSON
  --ndjson                {"name":"...","version":"...","present":true} per line

Examples:
  # From lockfile
  flatcover package-lock.json --cover
  flatcover package-lock.json --cover --full --json

  # From JSON list file
  flatcover --list packages.json --cover --summary
  echo '[{"name":"lodash","version":"4.17.21"}]' > pkgs.json && flatcover -l pkgs.json --cover

  # From stdin (NDJSON) - use '-' to read from stdin
  echo '{"name":"lodash","version":"4.17.21"}' | flatcover - --cover
  cat packages.ndjson | flatcover - --cover --json

  # With custom registry
  flatcover package-lock.json --cover --registry https://npm.pkg.github.com --token ghp_xxx
  flatcover pnpm-lock.yaml --cover --auth admin:secret --ndjson`);
  process.exit(values.help ? 0 : 1);
}

if (values.json && values.ndjson) {
  console.error('Error: --json and --ndjson are mutually exclusive');
  process.exit(1);
}

if (values.auth && values.token) {
  console.error('Error: --auth and --token are mutually exclusive');
  process.exit(1);
}

// Validate mutually exclusive input sources
// Note: useStdin means positionals[0] === '-', so it's already counted in positionals.length
if (positionals.length > 0 && values.list) {
  console.error('Error: Cannot use both lockfile/stdin and --list');
  process.exit(1);
}

// --workspace only works with lockfile input (not stdin or --list)
if (values.workspace && (useStdin || values.list || !positionals.length)) {
  console.error('Error: --workspace can only be used with lockfile input');
  process.exit(1);
}

// --full implies --specs
if (values.full) {
  values.specs = true;
}

// --cover implies --specs (need versions to check)
if (values.cover) {
  values.specs = true;
}

const lockfilePath = positionals[0];
const concurrency = Math.max(1, Math.min(50, Number.parseInt(values.concurrency, 10) || 20));

/**
 * Read packages from a JSON list file
 * @param {string} filePath - Path to JSON file containing [{name, version}, ...]
 * @returns {Array<{ name: string, version: string }>}
 */
function readJsonList(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);

  if (!Array.isArray(data)) {
    throw new Error('--list file must contain a JSON array');
  }

  const packages = [];
  for (const item of data) {
    if (!item.name || !item.version) {
      throw new Error('Each item in --list must have "name" and "version" fields');
    }
    packages.push({
      name: item.name,
      version: item.version,
      integrity: item.integrity,
      resolved: item.resolved
    });
  }

  return packages;
}

/**
 * Read packages from stdin as NDJSON
 * @returns {Promise<Array<{ name: string, version: string }>>}
 */
async function readStdinNdjson() {
  const packages = [];

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const item = JSON.parse(trimmed);
      if (!item.name || !item.version) {
        throw new Error('Each line must have "name" and "version" fields');
      }
      packages.push({
        name: item.name,
        version: item.version,
        integrity: item.integrity,
        resolved: item.resolved
      });
    } catch (err) {
      throw new Error(`Invalid JSON on stdin: ${err.message}`);
    }
  }

  return packages;
}

/**
 * Encode package name for URL (handle scoped packages)
 * @param {string} name - Package name like @babel/core
 * @returns {string} URL-safe name like @babel%2fcore
 */
function encodePackageName(name) {
  // Scoped packages: @scope/name -> @scope%2fname
  return name.replace('/', '%2f');
}

/**
 * Create undici client with retry support
 * @param {string} registryUrl
 * @param {{ auth?: string, token?: string }} options
 * @returns {{ client: RetryAgent, headers: Record<string, string>, baseUrl: URL }}
 */
function createClient(registryUrl, { auth, token }) {
  const baseUrl = new URL(registryUrl);

  const pool = new Pool(baseUrl.origin, {
    connections: Math.min(concurrency, 50),
    pipelining: 1, // Conservative - most proxies don't support HTTP pipelining
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000
  });

  const client = new RetryAgent(pool, {
    maxRetries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    timeoutFactor: 2,
    retryAfter: true, // Respect Retry-After header
    statusCodes: [429, 500, 502, 503, 504],
    errorCodes: [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ENETUNREACH',
      'ETIMEDOUT',
      'UND_ERR_SOCKET'
    ]
  });

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'flatcover/1.0.0'
  };

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(auth).toString('base64')}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return { client, headers, baseUrl };
}

/**
 * Check coverage for all dependencies
 * @param {Array<{ name: string, version: string, integrity?: string, resolved?: string }>} deps
 * @param {{ registry: string, auth?: string, token?: string, progress: boolean }} options
 * @returns {AsyncGenerator<{ name: string, version: string, present: boolean, integrity?: string, resolved?: string, error?: string }>}
 */
async function* checkCoverage(deps, { registry, auth, token, progress }) {
  const { client, headers, baseUrl } = createClient(registry, { auth, token });

  // Group by package name to avoid duplicate requests
  // Store full dep info (including integrity/resolved) keyed by version
  /** @type {Map<string, Map<string, { name: string, version: string, integrity?: string, resolved?: string }>>} */
  const byPackage = new Map();
  for (const dep of deps) {
    if (!byPackage.has(dep.name)) {
      byPackage.set(dep.name, new Map());
    }
    byPackage.get(dep.name).set(dep.version, dep);
  }

  const packages = [...byPackage.entries()];
  let completed = 0;
  const total = deps.length;

  // Process in batches for bounded concurrency
  for (let i = 0; i < packages.length; i += concurrency) {
    const batch = packages.slice(i, i + concurrency);

    const results = await Promise.all(
      batch.map(async ([name, versionMap]) => {
        const encodedName = encodePackageName(name);
        const basePath = baseUrl.pathname.replace(/\/$/, '');
        const path = `${basePath}/${encodedName}`;

        try {
          const response = await client.request({
            method: 'GET',
            path,
            headers
          });

          const chunks = [];
          for await (const chunk of response.body) {
            chunks.push(chunk);
          }

          if (response.statusCode === 401 || response.statusCode === 403) {
            console.error(`Error: Authentication failed for ${name} (${response.statusCode})`);
            process.exit(1);
          }

          let packumentVersions = null;
          if (response.statusCode === 200) {
            const body = Buffer.concat(chunks).toString('utf8');
            const packument = JSON.parse(body);
            packumentVersions = packument.versions || {};
          }

          // Check each version, preserving integrity/resolved from original dep
          const versionResults = [];
          for (const [version, dep] of versionMap) {
            const present = packumentVersions ? !!packumentVersions[version] : false;
            const result = { name, version, present };
            if (dep.integrity) result.integrity = dep.integrity;
            if (dep.resolved) result.resolved = dep.resolved;
            versionResults.push(result);
          }
          return versionResults;
        } catch (err) {
          // Return error for all versions of this package
          return [...versionMap.values()].map(dep => {
            const result = {
              name: dep.name,
              version: dep.version,
              present: false,
              error: err.message
            };
            if (dep.integrity) result.integrity = dep.integrity;
            if (dep.resolved) result.resolved = dep.resolved;
            return result;
          });
        }
      })
    );

    // Flatten and yield results
    for (const packageResults of results) {
      for (const result of packageResults) {
        yield result;
        completed++;
        if (progress) {
          process.stderr.write(`\r  Checking: ${completed}/${total} packages`);
        }
      }
    }
  }

  if (progress) {
    process.stderr.write('\n');
  }
}

/**
 * Format a single dependency based on output options
 * @param {{ name: string, version: string, integrity?: string, resolved?: string }} dep
 * @param {{ specs: boolean, full: boolean }} options
 * @returns {string | object}
 */
function formatDep(dep, { specs, full }) {
  if (full) {
    const obj = { name: dep.name, version: dep.version };
    if (dep.integrity) obj.integrity = dep.integrity;
    if (dep.resolved) obj.resolved = dep.resolved;
    return obj;
  }
  if (specs) {
    return { name: dep.name, version: dep.version };
  }
  return dep.name;
}

/**
 * Output dependencies in the requested format (non-cover mode)
 * @param {Iterable<{ name: string, version: string, integrity?: string, resolved?: string }>} deps
 * @param {{ specs: boolean, json: boolean, ndjson: boolean, full: boolean }} options
 */
function outputDeps(deps, { specs, json, ndjson, full }) {
  const sorted = [...deps].sort((a, b) => a.name.localeCompare(b.name));

  if (json) {
    const data = sorted.map(d => formatDep(d, { specs, full }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (ndjson) {
    for (const d of sorted) {
      console.log(JSON.stringify(formatDep(d, { specs, full })));
    }
    return;
  }

  // Plain text
  for (const d of sorted) {
    console.log(specs ? `${d.name}@${d.version}` : d.name);
  }
}

/**
 * Output coverage results
 * @param {AsyncGenerator<{ name: string, version: string, present: boolean, integrity?: string, resolved?: string, error?: string }>} results
 * @param {{ json: boolean, ndjson: boolean, summary: boolean, full: boolean }} options
 */
async function outputCoverage(results, { json, ndjson, summary, full }) {
  const all = [];
  let presentCount = 0;
  let missingCount = 0;

  for await (const result of results) {
    if (result.present) {
      presentCount++;
    } else {
      missingCount++;
    }

    if (ndjson) {
      // Stream immediately
      const obj = { name: result.name, version: result.version, present: result.present };
      if (full && result.integrity) obj.integrity = result.integrity;
      if (full && result.resolved) obj.resolved = result.resolved;
      console.log(JSON.stringify(obj));
    } else {
      all.push(result);
    }
  }

  if (!ndjson) {
    // Sort by name, then version
    all.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

    if (json) {
      const data = all.map(r => {
        const obj = { name: r.name, version: r.version, present: r.present };
        if (full && r.integrity) obj.integrity = r.integrity;
        if (full && r.resolved) obj.resolved = r.resolved;
        return obj;
      });
      console.log(JSON.stringify(data, null, 2));
    } else {
      // CSV output
      if (full) {
        console.log('package,version,present,integrity,resolved');
        for (const r of all) {
          console.log(`${r.name},${r.version},${r.present},${r.integrity || ''},${r.resolved || ''}`);
        }
      } else {
        console.log('package,version,present');
        for (const r of all) {
          console.log(`${r.name},${r.version},${r.present}`);
        }
      }
    }
  }

  if (summary) {
    const total = presentCount + missingCount;
    const percentage = total > 0 ? ((presentCount / total) * 100).toFixed(1) : 0;
    process.stderr.write(`\nCoverage: ${presentCount}/${total} (${percentage}%) packages present\n`);
    if (missingCount > 0) {
      process.stderr.write(`Missing: ${missingCount} packages\n`);
    }
  }
}

try {
  let deps;

  // Determine input source and load dependencies
  if (useStdin) {
    // Read from stdin (NDJSON)
    deps = await readStdinNdjson();
    if (deps.length === 0) {
      console.error('Error: No packages read from stdin');
      process.exit(1);
    }
  } else if (values.list) {
    // Read from JSON list file
    deps = readJsonList(values.list);
    if (deps.length === 0) {
      console.error('Error: No packages found in --list file');
      process.exit(1);
    }
  } else {
    // Read from lockfile (existing behavior)
    const lockfile = await FlatlockSet.fromPath(lockfilePath);

    if (values.workspace) {
      const repoDir = dirname(lockfilePath);
      const workspacePkgPath = join(repoDir, values.workspace, 'package.json');
      const workspacePkg = JSON.parse(readFileSync(workspacePkgPath, 'utf8'));

      deps = await lockfile.dependenciesOf(workspacePkg, {
        workspacePath: values.workspace,
        repoDir,
        dev: values.dev,
        peer: values.peer
      });
    } else {
      deps = lockfile;
    }
  }

  if (values.cover) {
    // Coverage mode
    const sorted = [...deps].sort((a, b) => a.name.localeCompare(b.name));
    const results = checkCoverage(sorted, {
      registry: values.registry,
      auth: values.auth,
      token: values.token,
      progress: values.progress
    });

    await outputCoverage(results, {
      json: values.json,
      ndjson: values.ndjson,
      summary: values.summary,
      full: values.full
    });
  } else {
    // Standard flatlock mode
    outputDeps(deps, {
      specs: values.specs,
      json: values.json,
      ndjson: values.ndjson,
      full: values.full
    });
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
