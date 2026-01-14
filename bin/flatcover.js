#!/usr/bin/env node
/**
 * flatcover - Check registry coverage for lockfile dependencies
 *
 * Extends flatlock functionality with registry coverage checking.
 * Verifies that each dependency version exists in the specified npm registry.
 *
 * Usage:
 *   flatcover <lockfile> --cover                           # CSV output
 *   flatcover <lockfile> --cover --json                    # JSON array
 *   flatcover <lockfile> --cover --ndjson                  # streaming NDJSON
 *   flatcover <lockfile> --cover --registry <url>          # custom registry
 *   flatcover <lockfile> --cover --auth user:pass          # Basic auth
 *   flatcover <lockfile> --cover --token <token>           # Bearer token
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Pool, RetryAgent } from 'undici';
import { FlatlockSet } from '../src/set.js';

const { values, positionals } = parseArgs({
  options: {
    // Original flatlock options
    workspace: { type: 'string', short: 'w' },
    dev: { type: 'boolean', default: false },
    peer: { type: 'boolean', default: true },
    specs: { type: 'boolean', short: 's', default: false },
    json: { type: 'boolean', default: false },
    ndjson: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    // Coverage options
    cover: { type: 'boolean', default: false },
    registry: { type: 'string', default: 'https://registry.npmjs.org' },
    auth: { type: 'string' },
    token: { type: 'string' },
    concurrency: { type: 'string', default: '20' },
    progress: { type: 'boolean', default: false },
    summary: { type: 'boolean', default: false }
  },
  allowPositionals: true
});

if (values.help || positionals.length === 0) {
  console.log(`flatcover - Check registry coverage for lockfile dependencies

Usage:
  flatcover <lockfile> --cover
  flatcover <lockfile> --cover --workspace <path>
  flatcover <lockfile> --cover --registry <url>

Options:
  -w, --workspace <path>   Workspace path within monorepo
  -s, --specs              Include version in non-cover output
  --json                   Output as JSON array
  --ndjson                 Output as newline-delimited JSON (streaming)
  --full                   Include all metadata (integrity, resolved)
  --dev                    Include dev dependencies (default: false)
  --peer                   Include peer dependencies (default: true)
  -h, --help               Show this help

Coverage options:
  --cover                  Enable registry coverage checking
  --registry <url>         npm registry URL (default: https://registry.npmjs.org)
  --auth <user:pass>       Basic authentication credentials
  --token <token>          Bearer token for authentication
  --concurrency <n>        Concurrent requests (default: 20)
  --progress               Show progress on stderr
  --summary                Show coverage summary on stderr

Output formats (with --cover):
  (default)                CSV: package,version,present
  --json                   [{"name":"...","version":"...","present":true}, ...]
  --ndjson                 {"name":"...","version":"...","present":true} per line

Examples:
  flatcover package-lock.json --cover
  flatcover package-lock.json --cover --json
  flatcover package-lock.json --cover --registry https://registry.company.com --auth user:pass
  flatcover package-lock.json --cover --registry https://npm.pkg.github.com --token ghp_xxx
  flatcover pnpm-lock.yaml -w packages/core --cover --progress --summary`);
  process.exit(values.help ? 0 : 1);
}

if (values.json && values.ndjson) {
  console.error('Error: --json and --ndjson are mutually exclusive');
  process.exit(1);
}

// --full implies --specs
if (values.full) {
  values.specs = true;
}

const lockfilePath = positionals[0];
const concurrency = Number.parseInt(values.concurrency, 10) || 20;

/**
 * Encode package name for registry URL
 * Scoped packages: @babel/core -> @babel%2fcore
 * @param {string} name - Package name
 * @returns {string} URL-safe package name
 */
function encodePackageName(name) {
  return name.replace('/', '%2f');
}

/**
 * Create HTTP headers with optional authentication
 * @param {{ auth?: string, token?: string }} options
 * @returns {Record<string, string>}
 */
function createHeaders({ auth, token }) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'flatcover/1.0.0 (https://github.com/indexzero/flatlock)'
  };

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(auth).toString('base64')}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Create undici client with RetryAgent for resilient requests
 * @param {string} registry - Registry URL
 * @returns {{ client: RetryAgent, baseUrl: URL }}
 */
function createClient(registry) {
  const baseUrl = new URL(registry);

  const pool = new Pool(baseUrl.origin, {
    connections: Math.min(concurrency, 50), // Don't exceed 50 connections
    pipelining: 1, // Conservative - most proxies don't support HTTP pipelining
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000
  });

  const client = new RetryAgent(pool, {
    maxRetries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    timeoutFactor: 2,
    retryAfter: true, // Respect Retry-After header from 429 responses
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

  return { client, baseUrl };
}

/**
 * Check if a specific package version exists in the registry
 * @param {RetryAgent} client - undici client
 * @param {URL} baseUrl - Registry base URL
 * @param {Record<string, string>} headers - Request headers
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {Promise<{ name: string, version: string, present: boolean }>}
 */
async function checkPackage(client, baseUrl, headers, name, version) {
  const path = `${baseUrl.pathname.replace(/\/$/, '')}/${encodePackageName(name)}`;

  try {
    const { statusCode, body } = await client.request({
      method: 'GET',
      path,
      headers
    });

    // Package not found on registry
    if (statusCode === 404) {
      await body.dump(); // Consume body to release connection
      return { name, version, present: false };
    }

    // Authentication error - fail fast
    if (statusCode === 401 || statusCode === 403) {
      await body.dump();
      throw new Error(
        `Authentication failed for ${name}: ${statusCode}. Check --auth or --token credentials.`
      );
    }

    // Unexpected status
    if (statusCode !== 200) {
      const text = await body.text();
      console.error(`Warning: ${name} returned HTTP ${statusCode}: ${text.slice(0, 100)}`);
      return { name, version, present: false };
    }

    // Parse packument and check for version
    const text = await body.text();
    const packument = JSON.parse(text);
    const present = packument.versions != null && version in packument.versions;

    return { name, version, present };
  } catch (err) {
    // Re-throw auth errors
    if (err.message.includes('Authentication failed')) {
      throw err;
    }
    console.error(`Error checking ${name}@${version}: ${err.message}`);
    return { name, version, present: false };
  }
}

/**
 * Check coverage for all dependencies with bounded concurrency
 * @param {Iterable<{ name: string, version: string }>} deps - Dependencies
 * @param {RetryAgent} client - undici client
 * @param {URL} baseUrl - Registry base URL
 * @param {Record<string, string>} headers - Request headers
 * @param {{ concurrency: number, progress: boolean }} options
 * @returns {Promise<Array<{ name: string, version: string, present: boolean }>>}
 */
async function checkCoverage(deps, client, baseUrl, headers, options) {
  const packages = [...deps];
  const results = [];
  const total = packages.length;

  for (let i = 0; i < packages.length; i += options.concurrency) {
    const batch = packages.slice(i, i + options.concurrency);

    const batchResults = await Promise.all(
      batch.map((d) => checkPackage(client, baseUrl, headers, d.name, d.version))
    );

    results.push(...batchResults);

    if (options.progress) {
      const checked = Math.min(i + options.concurrency, total);
      process.stderr.write(`\rChecking: ${checked}/${total} packages...`);
    }
  }

  if (options.progress) {
    process.stderr.write('\n');
  }

  return results;
}

/**
 * Output coverage results in requested format
 * @param {Array<{ name: string, version: string, present: boolean }>} results
 * @param {{ json: boolean, ndjson: boolean }} options
 */
function outputCoverage(results, { json, ndjson }) {
  const sorted = results.sort((a, b) => a.name.localeCompare(b.name));

  if (json) {
    const data = sorted.map((r) => ({
      name: r.name,
      version: r.version,
      present: r.present
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (ndjson) {
    for (const r of sorted) {
      console.log(JSON.stringify({ name: r.name, version: r.version, present: r.present }));
    }
    return;
  }

  // CSV output with header
  console.log('package,version,present');
  for (const r of sorted) {
    console.log(`${r.name},${r.version},${r.present}`);
  }
}

/**
 * Format a single dependency for non-coverage output
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
 * Output dependencies in the requested format (non-coverage mode)
 * @param {Iterable<{ name: string, version: string, integrity?: string, resolved?: string }>} deps
 * @param {{ specs: boolean, json: boolean, ndjson: boolean, full: boolean }} options
 */
function outputDeps(deps, { specs, json, ndjson, full }) {
  const sorted = [...deps].sort((a, b) => a.name.localeCompare(b.name));

  if (json) {
    const data = sorted.map((d) => formatDep(d, { specs, full }));
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

// Main execution
try {
  const lockfile = await FlatlockSet.fromPath(lockfilePath);
  let deps;

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

  // Coverage mode
  if (values.cover) {
    const { client, baseUrl } = createClient(values.registry);
    const headers = createHeaders({ auth: values.auth, token: values.token });

    const results = await checkCoverage(deps, client, baseUrl, headers, {
      concurrency,
      progress: values.progress
    });

    if (values.summary) {
      const presentCount = results.filter((r) => r.present).length;
      const percentage = ((presentCount / results.length) * 100).toFixed(1);
      console.error(`Coverage: ${presentCount}/${results.length} packages present (${percentage}%)`);
    }

    outputCoverage(results, {
      json: values.json,
      ndjson: values.ndjson
    });

    // Close the pool gracefully
    await client.close();
  } else {
    // Non-coverage mode - same as flatlock
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
