/**
 * lerna/lerna monorepo tests (npm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's npm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'lerna/lerna';
const branch = 'main';
const lockfileName = npm.lockfileName;

describe('lerna/lerna', { timeout: 300_000 }, () => {
  it('packages/lerna', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/lerna' }));
});
