/**
 * facebook/jest monorepo tests (yarn berry)
 *
 * Uses ground truth: install published package, compare names.
 *
 * Known limitation: Published jest may have different dependency versions
 * than the monorepo lockfile. Platform-specific bindings that exist in npm
 * but not in yarn.lock are expected differences.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testWorkspaceGroundTruth, cleanup } from '../../support/monorepo.js';
import * as yarn from '../../support/yarn.js';

const repo = 'facebook/jest';
const branch = 'main';

// Packages that differ due to version pinning or platform-specific bindings
// These exist in published package but not in monorepo lockfile
const KNOWN_VERSION_DIFFERENCES = new Set([
  '@unrs/resolver-binding-android-arm-eabi',
  '@unrs/resolver-binding-android-arm64'
]);

async function assertGroundTruth(workspace) {
  let tmpDir;
  try {
    const result = await testWorkspaceGroundTruth({
      repo, branch, workspace,
      lockfileName: yarn.lockfileName
    });
    tmpDir = result.tmpDir;
    const { groundTruthNames, flatlockNames } = result;

    console.log(`    ground truth: ${groundTruthNames.size} packages`);
    console.log(`    flatlock:     ${flatlockNames.size} packages`);

    const missing = [...groundTruthNames].filter(n => !flatlockNames.has(n));
    const unexpectedMissing = missing.filter(n => !KNOWN_VERSION_DIFFERENCES.has(n));
    console.log(`    missing:      ${missing.length} (${unexpectedMissing.length} unexpected)`);

    if (unexpectedMissing.length > 0) {
      console.log(`    UNEXPECTED MISSING: ${unexpectedMissing.slice(0, 10).join(', ')}`);
    }

    assert.strictEqual(unexpectedMissing.length, 0,
      `flatlock missing ${unexpectedMissing.length} unexpected package names: ${unexpectedMissing.join(', ')}`);
  } finally {
    if (tmpDir) await cleanup(tmpDir);
  }
}

describe('facebook/jest', { timeout: 300_000 }, () => {
  it('packages/jest', () => assertGroundTruth('packages/jest'));
  it('packages/jest-cli', () => assertGroundTruth('packages/jest-cli'));
});
