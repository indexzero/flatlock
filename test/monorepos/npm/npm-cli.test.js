/**
 * npm/cli monorepo tests (npm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's npm parser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testWorkspaceGroundTruth, cleanup } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'npm/cli';
const branch = 'latest';

async function assertGroundTruth(workspace) {
  let tmpDir;
  try {
    const result = await testWorkspaceGroundTruth({
      repo, branch, workspace,
      lockfileName: npm.lockfileName
    });
    tmpDir = result.tmpDir;
    const { groundTruthNames, flatlockNames } = result;

    console.log(`    ground truth: ${groundTruthNames.size} packages`);
    console.log(`    flatlock:     ${flatlockNames.size} packages`);

    const missing = [...groundTruthNames].filter(n => !flatlockNames.has(n));
    console.log(`    missing:      ${missing.length}`);

    if (missing.length > 0) {
      console.log(`    MISSING: ${missing.slice(0, 10).join(', ')}`);
    }

    assert.strictEqual(missing.length, 0,
      `flatlock missing ${missing.length} package names`);
  } finally {
    if (tmpDir) await cleanup(tmpDir);
  }
}

describe('npm/cli', { timeout: 300_000 }, () => {
  it('workspaces/arborist', () => assertGroundTruth('workspaces/arborist'));
  it('workspaces/libnpmexec', () => assertGroundTruth('workspaces/libnpmexec'));
  it('workspaces/config', () => assertGroundTruth('workspaces/config'));
});
