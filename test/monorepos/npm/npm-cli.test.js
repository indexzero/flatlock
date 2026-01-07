/**
 * npm/cli monorepo tests (npm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's npm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'npm/cli';
const branch = 'latest';
const lockfileName = npm.lockfileName;

describe('npm/cli', { timeout: 300_000 }, () => {
  it('workspaces/arborist', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'workspaces/arborist' }));

  it('workspaces/libnpmexec', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'workspaces/libnpmexec' }));

  it('workspaces/config', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'workspaces/config' }));
});
