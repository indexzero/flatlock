/**
 * Three-Way Verification Tests
 *
 * Verifies that three methods produce equivalent results:
 * 1. flatlock.dependenciesOf(monorepo_lockfile, workspace)
 * 2. CycloneDX(npm install published_package)
 * 3. flatlock(npm install published_package)
 *
 * Method 2 and 3 should ALWAYS be equal (same input).
 * Method 1 may differ from 2/3 due to version drift.
 *
 * This is the ultimate truth test: if all three agree, we have found truth.
 * If they disagree, we can diagnose exactly where the bug is.
 */

import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanup, cloneRepo } from '../support/monorepo.js';
import { getThreeWayComparison, isPlatformSpecific } from '../support/parity.js';

// Known version differences that are expected
const KNOWN_VERSION_DIFFERENCES = {
  'socketio/socket.io': new Set(['undici-types']),
  'facebook/jest': new Set([
    '@unrs/resolver-binding-android-arm-eabi',
    '@unrs/resolver-binding-android-arm64'
  ])
};

/**
 * Run three-way verification for a monorepo workspace
 */
async function assertThreeWay(repo, branch, workspace, lockfileName, buildWorkspaceMap) {
  let tmpDir;

  try {
    console.log(`    Cloning ${repo}@${branch}...`);
    tmpDir = await cloneRepo(repo, branch);

    const lockfilePath = join(tmpDir, lockfileName);
    const workspacePkgPath = join(tmpDir, workspace, 'package.json');
    const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));

    // Build workspace packages map
    const workspacePackages = await buildWorkspaceMap(tmpDir, lockfilePath);

    console.log(
      `    Running three-way comparison for ${workspacePkg.name}@${workspacePkg.version}...`
    );

    const result = await getThreeWayComparison(
      lockfilePath,
      workspacePkg,
      workspace,
      workspacePackages
    );

    // Report results
    console.log(`    Monorepo:       ${result.counts.monorepo} packages`);
    console.log(`    CycloneDX:      ${result.counts.cyclonedx} packages`);
    console.log(`    Fresh Flatlock: ${result.counts.freshFlatlock} packages`);

    // Check parser parity (CycloneDX vs Fresh Flatlock)
    if (result.parserParity.equal) {
      console.log(`    Parser parity: PASS (CycloneDX == Fresh Flatlock)`);
    } else {
      console.log(`    Parser parity: FAIL`);
      if (result.parserParity.onlyInCycloneDX.length > 0) {
        console.log(`      Only in CycloneDX: ${result.parserParity.onlyInCycloneDX.join(', ')}`);
      }
      if (result.parserParity.onlyInFlatlock.length > 0) {
        console.log(`      Only in Flatlock: ${result.parserParity.onlyInFlatlock.join(', ')}`);
      }
    }

    // Check monorepo vs fresh (version drift)
    const knownDiff = KNOWN_VERSION_DIFFERENCES[repo] || new Set();
    const unexpectedMissing = result.monorepoVsFresh.missingFromMonorepo.filter(
      n => !knownDiff.has(n) && !isPlatformSpecific(n)
    );

    if (unexpectedMissing.length === 0) {
      const expected = result.monorepoVsFresh.missingFromMonorepo.length - unexpectedMissing.length;
      console.log(`    Monorepo vs Fresh: PASS (${expected} expected differences)`);
    } else {
      console.log(`    Monorepo vs Fresh: FAIL (${unexpectedMissing.length} unexpected)`);
      console.log(`      Unexpected missing: ${unexpectedMissing.join(', ')}`);
    }

    // Assert parser parity (should always pass)
    assert.strictEqual(
      result.parserParity.equal,
      true,
      `Parser parity failed: CycloneDX vs Fresh Flatlock differ`
    );

    // Assert monorepo completeness (excluding known differences)
    assert.strictEqual(
      unexpectedMissing.length,
      0,
      `Monorepo missing ${unexpectedMissing.length} unexpected packages: ${unexpectedMissing.join(', ')}`
    );
  } finally {
    if (tmpDir) await cleanup(tmpDir);
  }
}

// npm monorepos
describe('Three-Way: npm monorepos', { timeout: 600_000 }, () => {
  it('npm/cli - workspaces/arborist', () =>
    assertThreeWay(
      'npm/cli',
      'latest',
      'workspaces/arborist',
      'package-lock.json',
      (dir, lockPath) => buildNpmWorkspacePackagesMap(dir, lockPath)
    ));

  it('socketio/socket.io - packages/socket.io', () =>
    assertThreeWay(
      'socketio/socket.io',
      'main',
      'packages/socket.io',
      'package-lock.json',
      (dir, lockPath) => buildNpmWorkspacePackagesMap(dir, lockPath)
    ));
});

// Import the workspace map builders from monorepo.js
async function buildNpmWorkspacePackagesMap(dir, lockfilePath) {
  const content = await readFile(lockfilePath, 'utf8');
  const lockfile = JSON.parse(content);
  const workspacePackages = {};
  const packages = lockfile.packages || {};

  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || key.includes('node_modules') || !entry.version) continue;

    let name = entry.name;
    if (!name) {
      try {
        const pkgPath = join(dir, key, 'package.json');
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

  return workspacePackages;
}
