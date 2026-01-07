/**
 * socketio/socket.io monorepo tests (npm)
 *
 * Uses ground truth: install published package, compare names.
 *
 * Known limitation: The monorepo pins @types/node@18.x which doesn't depend
 * on undici-types. A fresh npm install resolves newer @types/node with
 * undici-types. This is expected - flatlock reports what's in the lockfile.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'socketio/socket.io';
const branch = 'main';
const lockfileName = npm.lockfileName;

// Packages that differ due to version pinning, not parsing bugs
const knownVersionDifferences = new Set([
  'undici-types' // Monorepo pins older @types/node without this dep
]);

describe('socketio/socket.io', { timeout: 300_000 }, () => {
  it('packages/socket.io', () =>
    assertGroundTruth({ repo, branch, lockfileName, knownVersionDifferences, workspace: 'packages/socket.io' }));

  it('packages/engine.io', () =>
    assertGroundTruth({ repo, branch, lockfileName, knownVersionDifferences, workspace: 'packages/engine.io' }));

  it('packages/socket.io-client', () =>
    assertGroundTruth({ repo, branch, lockfileName, knownVersionDifferences, workspace: 'packages/socket.io-client' }));
});
