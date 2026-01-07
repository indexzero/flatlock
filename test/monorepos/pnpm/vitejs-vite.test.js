/**
 * vitejs/vite monorepo tests (pnpm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's pnpm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as pnpm from '../../support/pnpm.js';

const repo = 'vitejs/vite';
const branch = 'main';
const lockfileName = pnpm.lockfileName;

describe('vitejs/vite', { timeout: 300_000 }, () => {
  it('packages/vite', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/vite' }));

  it('packages/create-vite', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/create-vite' }));
});
