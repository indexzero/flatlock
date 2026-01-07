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
import assert from 'node:assert';
import { testWorkspaceGroundTruth, cleanup } from '../../support/monorepo.js';
import * as npm from '../../support/npm.js';

const repo = 'socketio/socket.io';
const branch = 'main';

// Packages that differ due to version pinning, not parsing bugs
const KNOWN_VERSION_DIFFERENCES = new Set([
  'undici-types' // Monorepo pins older @types/node without this dep
]);

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

describe('socketio/socket.io', { timeout: 300_000 }, () => {
  it('packages/socket.io', () => assertGroundTruth('packages/socket.io'));
  it('packages/engine.io', () => assertGroundTruth('packages/engine.io'));
  it('packages/socket.io-client', () => assertGroundTruth('packages/socket.io-client'));
});
