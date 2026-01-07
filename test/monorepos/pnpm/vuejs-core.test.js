/**
 * vuejs/core monorepo tests (pnpm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's pnpm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as pnpm from '../../support/pnpm.js';

const repo = 'vuejs/core';
const branch = 'main';
const lockfileName = pnpm.lockfileName;

describe('vuejs/core', { timeout: 300_000 }, () => {
  it('packages/vue', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/vue' }));

  it('packages/reactivity', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/reactivity' }));

  it('packages/compiler-core', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/compiler-core' }));
});
