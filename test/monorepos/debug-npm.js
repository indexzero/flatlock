/**
 * Debug script for npm workspace issues
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FlatlockSet } from '../../src/set.js';

const repoDir = '/tmp/socketio-test';
const workspace = 'packages/socket.io';
const lockfilePath = join(repoDir, 'package-lock.json');
const workspacePkgPath = join(repoDir, workspace, 'package.json');

// Build workspace packages map
const content = await readFile(lockfilePath, 'utf8');
const lockfile = JSON.parse(content);

const workspacePackages = {};
const packages = lockfile.packages || {};

for (const [key, entry] of Object.entries(packages)) {
  if (key === '' || key.includes('node_modules') || !entry.version) continue;

  let name = entry.name;
  if (!name) {
    try {
      const pkgPath = join(repoDir, key, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      name = pkg.name;
    } catch {
      continue;
    }
  }
  if (name) {
    workspacePackages[key] = { name, version: entry.version };
  }
}

console.log('=== Workspace packages map ===');
for (const [path, pkg] of Object.entries(workspacePackages)) {
  console.log(`  ${path} -> ${pkg.name}@${pkg.version}`);
}

console.log('\n=== Workspace package.json ===');
const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));
console.log('name:', workspacePkg.name);
console.log('dependencies:', workspacePkg.dependencies);

console.log('\n=== Name to workspace mapping ===');
const nameToWorkspace = new Map();
for (const [wsPath, pkg] of Object.entries(workspacePackages)) {
  nameToWorkspace.set(pkg.name, wsPath);
}
console.log('engine.io ->', nameToWorkspace.get('engine.io'));
console.log('socket.io-adapter ->', nameToWorkspace.get('socket.io-adapter'));
console.log('socket.io-parser ->', nameToWorkspace.get('socket.io-parser'));

console.log('\n=== dependenciesOf ===');
const flatlockSet = await FlatlockSet.fromPath(lockfilePath);
const deps = flatlockSet.dependenciesOf(workspacePkg, {
  workspacePath: workspace,
  dev: false,
  peer: true,
  workspacePackages
});

console.log('Found:', deps.size, 'dependencies');
for (const dep of deps) {
  console.log(' -', dep.name, dep.version);
}
