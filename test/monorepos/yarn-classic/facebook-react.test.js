/**
 * facebook/react monorepo tests (yarn classic)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's yarn parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as yarn from '../../support/yarn.js';

const repo = 'facebook/react';
// Use v19.0.0 tag - main branch has unpublished versions
const branch = 'v19.0.0';
const lockfileName = yarn.lockfileName;

describe('facebook/react', { timeout: 300_000 }, () => {
  it('packages/react', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/react' }));

  it('packages/react-dom', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/react-dom' }));
});
