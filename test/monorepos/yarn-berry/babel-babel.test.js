/**
 * babel/babel monorepo tests (yarn berry)
 *
 * Uses ground truth: install published package, compare names.
 * Failures are bugs in flatlock's yarn parser.
 */

import { describe, it } from 'node:test';
import { assertGroundTruth } from '../../support/monorepo.js';
import * as yarn from '../../support/yarn.js';

const repo = 'babel/babel';
const branch = 'main';
const lockfileName = yarn.lockfileName;

describe('babel/babel', { timeout: 300_000 }, () => {
  it('packages/babel-core', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/babel-core' }));

  it('packages/babel-parser', () =>
    assertGroundTruth({ repo, branch, lockfileName, workspace: 'packages/babel-parser' }));
});
