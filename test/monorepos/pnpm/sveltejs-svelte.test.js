/**
 * sveltejs/svelte monorepo tests (pnpm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's pnpm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as pnpm from '../../support/pnpm.js';

const repo = 'sveltejs/svelte';
const branch = 'main';
const lockfileName = pnpm.lockfileName;

describe('sveltejs/svelte', { timeout: 300_000 }, () => {
  it('packages/svelte', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/svelte' }));
});
