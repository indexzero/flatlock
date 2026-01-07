/**
 * facebook/react monorepo tests (yarn classic)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's yarn parser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testWorkspaceGroundTruth, cleanup } from '../../support/monorepo.js';
import * as yarn from '../../support/yarn.js';

const repo = 'facebook/react';
// Use v19.0.0 tag - main branch has unpublished versions
const branch = 'v19.0.0';

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

describe('facebook/react', { timeout: 300_000 }, () => {
  it('packages/react', () => assertGroundTruth('packages/react'));
  it('packages/react-dom', () => assertGroundTruth('packages/react-dom'));
});
