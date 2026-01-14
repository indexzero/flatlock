#!/usr/bin/env node
/**
 * flatlock - Get dependencies from a lockfile
 *
 * For monorepo workspaces, outputs the production dependencies of a workspace.
 * For standalone packages, outputs all production dependencies.
 *
 * Usage:
 *   flatlock <lockfile>                           # all deps (names only)
 *   flatlock <lockfile> --specs                   # name@version
 *   flatlock <lockfile> --json                    # JSON array
 *   flatlock <lockfile> --specs --json            # JSON with versions
 *   flatlock <lockfile> --specs --ndjson          # streaming NDJSON
 *   flatlock <lockfile> --full --ndjson           # full metadata streaming
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FlatlockSet } from '../src/set.js';

const { values, positionals } = parseArgs({
  options: {
    workspace: { type: 'string', short: 'w' },
    dev: { type: 'boolean', default: false },
    peer: { type: 'boolean', default: true },
    specs: { type: 'boolean', short: 's', default: false },
    json: { type: 'boolean', default: false },
    ndjson: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  },
  allowPositionals: true
});

if (values.help || positionals.length === 0) {
  console.log(`flatlock - Get dependencies from a lockfile

Usage:
  flatlock <lockfile>
  flatlock <lockfile> --workspace <path>

Options:
  -w, --workspace <path>  Workspace path within monorepo
  -s, --specs             Include version (name@version or {name,version})
  --json                  Output as JSON array
  --ndjson                Output as newline-delimited JSON (streaming)
  --full                  Include all metadata (integrity, resolved)
  --dev                   Include dev dependencies (default: false)
  --peer                  Include peer dependencies (default: true)
  -h, --help              Show this help

Output formats:
  (default)               package names, one per line
  --specs                 package@version, one per line
  --json                  ["package", ...]
  --specs --json          [{"name":"...","version":"..."}, ...]
  --full --json           [{"name":"...","version":"...","integrity":"...","resolved":"..."}, ...]
  --ndjson                "package" per line
  --specs --ndjson        {"name":"...","version":"..."} per line
  --full --ndjson         {"name":"...","version":"...","integrity":"...","resolved":"..."} per line

Examples:
  flatlock package-lock.json
  flatlock package-lock.json --specs
  flatlock package-lock.json --specs --json
  flatlock package-lock.json --full --ndjson | jq -c 'select(.name | startswith("@babel"))'
  flatlock pnpm-lock.yaml -w packages/core -s --ndjson`);
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
 * Output dependencies in the requested format
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

  outputDeps(deps, {
    specs: values.specs,
    json: values.json,
    ndjson: values.ndjson,
    full: values.full
  });
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
