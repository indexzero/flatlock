/**
 * facebook/jest monorepo tests (yarn berry)
 *
 * Uses ground truth: install published package, compare names.
 *
 * Known limitation: Published jest may have different dependency versions
 * than the monorepo lockfile. Platform-specific bindings that exist in npm
 * but not in yarn.lock are expected differences.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as yarn from '../../support/yarn.js';

const repo = 'facebook/jest';
const branch = 'main';
const lockfileName = yarn.lockfileName;

// Packages that differ due to version pinning or platform-specific bindings
// These exist in published package but not in monorepo lockfile
const knownVersionDifferences = new Set([
  '@unrs/resolver-binding-android-arm-eabi',
  '@unrs/resolver-binding-android-arm64'
]);

describe('facebook/jest', { timeout: 300_000 }, () => {
  it('packages/jest', () =>
    assertGroundTruth({
      repo,
      branch,
      lockfileName,
      knownVersionDifferences,
      workspace: 'packages/jest'
    }));

  it('packages/jest-cli', () =>
    assertGroundTruth({
      repo,
      branch,
      lockfileName,
      knownVersionDifferences,
      workspace: 'packages/jest-cli'
    }));
});
