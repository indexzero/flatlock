/**
 * feathersjs/feathers monorepo tests (npm)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's npm parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'feathersjs/feathers';
const branch = 'dove';
const lockfileName = npm.lockfileName;

describe('feathersjs/feathers', { timeout: 300_000 }, () => {
  it('packages/feathers', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/feathers' }));

  it('packages/express', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/express' }));

  it('packages/socketio', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/socketio' }));
});
