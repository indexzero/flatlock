#!/usr/bin/env node
/**
 * flatlock - Get dependencies from a lockfile
 *
 * For monorepo workspaces, outputs the production dependencies of a workspace.
 * For standalone packages, outputs all production dependencies.
 *
 * Usage:
 *   flatlock <lockfile>                           # all deps
 *   flatlock <lockfile> --workspace <path>        # workspace deps
 *   flatlock <lockfile> -w workspaces/arborist    # short form
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
  --dev                   Include dev dependencies (default: false)
  --peer                  Include peer dependencies (default: true)
  -h, --help              Show this help

Examples:
  flatlock package-lock.json
  flatlock package-lock.json -w workspaces/arborist
  flatlock pnpm-lock.yaml --workspace packages/core`);
  process.exit(values.help ? 0 : 1);
}

const lockfilePath = positionals[0];

try {
  const lockfile = await FlatlockSet.fromPath(lockfilePath);

  if (values.workspace) {
    // Workspace mode: get deps for specific workspace
    const repoDir = dirname(lockfilePath);
    const workspacePkgPath = join(repoDir, values.workspace, 'package.json');
    const workspacePkg = JSON.parse(readFileSync(workspacePkgPath, 'utf8'));

    const deps = await lockfile.dependenciesOf(workspacePkg, {
      workspacePath: values.workspace,
      repoDir,
      dev: values.dev,
      peer: values.peer
    });

    const names = [...deps].map(d => d.name).sort();
    for (const name of names) {
      console.log(name);
    }
  } else {
    // Standalone mode: all packages from lockfile
    const names = [...lockfile].map(p => p.name).sort();
    for (const name of names) {
      console.log(name);
    }
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
