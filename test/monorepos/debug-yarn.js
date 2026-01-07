/**
 * Debug script for yarn berry monorepo issues
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x } from 'tinyexec';
import { FlatlockSet } from '../../src/set.js';

const workspace = 'packages/babel-parser';

const repoDir = await mkdtemp(join(tmpdir(), 'check-'));
await x('git', ['clone', '--depth', '1', 'https://github.com/babel/babel.git', repoDir]);

const lockfilePath = join(repoDir, 'yarn.lock');
const workspacePkgPath = join(repoDir, workspace, 'package.json');

const flatlockSet = await FlatlockSet.fromPath(lockfilePath);
const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));

console.log('=== Workspace package.json ===');
console.log('name:', workspacePkg.name);
console.log('version:', workspacePkg.version);
console.log('dependencies:', workspacePkg.dependencies);

console.log('\n=== FlatlockSet ===');
console.log('Total deps:', flatlockSet.size);
console.log('Type:', flatlockSet.type);

// Check ALL @babel/types versions in the set
console.log('\n=== All @babel/types versions ===');
for (const dep of flatlockSet) {
  if (dep.name === '@babel/types') {
    console.log('Found:', dep.version, dep.resolved || '');
  }
}

// Try dependenciesOf
console.log('\n=== dependenciesOf ===');
const deps = flatlockSet.dependenciesOf(workspacePkg, {
  workspacePath: workspace,
  dev: false
});
console.log('Found:', deps.size, 'dependencies');
for (const dep of deps) {
  console.log(' -', dep.name, dep.version);
}

await rm(repoDir, { recursive: true, force: true });
