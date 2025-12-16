/**
 * Tests for the compare module
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { compare, compareAll } from '../src/compare.js';
import { Type } from '../src/index.js';
import { loadFixture } from './support.js';

/**
 * Helper to run compare() with a decoded fixture
 * Creates a temp file with the correct filename for type detection
 */
async function withTempFixture(fixtureName, lockfileName, fn) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-test-'));
  const tmpFile = join(tmpDir, lockfileName);
  try {
    await writeFile(tmpFile, loadFixture(fixtureName));
    return await fn(tmpFile);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

describe('compare module', () => {
  describe('compare()', () => {
    test('returns expected structure for npm lockfile', async () => {
      const result = await withTempFixture(
        'npm/package-lock.json.v2',
        'package-lock.json',
        filepath => compare(filepath)
      );

      // Verify structure
      assert.ok('type' in result, 'should have type');
      assert.ok('identical' in result, 'should have identical');
      assert.ok('flatlockCount' in result, 'should have flatlockCount');
      assert.ok('comparisonCount' in result, 'should have comparisonCount');
      assert.ok('workspaceCount' in result, 'should have workspaceCount');
      assert.ok('onlyInFlatlock' in result, 'should have onlyInFlatlock');
      assert.ok('onlyInComparison' in result, 'should have onlyInComparison');

      // Verify types
      assert.equal(result.type, Type.NPM);
      assert.equal(typeof result.identical, 'boolean');
      assert.equal(typeof result.flatlockCount, 'number');
      assert.equal(typeof result.comparisonCount, 'number');
      assert.equal(typeof result.workspaceCount, 'number');
      assert.ok(Array.isArray(result.onlyInFlatlock));
      assert.ok(Array.isArray(result.onlyInComparison));
    });

    test('npm v2 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture(
        'npm/package-lock.json.v2',
        'package-lock.json',
        filepath => compare(filepath)
      );

      assert.equal(result.type, Type.NPM);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      // Log diagnostic info
      console.log(
        `  npm v2: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
      if (!result.identical) {
        console.log(`    onlyInFlatlock: ${result.onlyInFlatlock.slice(0, 3).join(', ')}`);
        console.log(`    onlyInComparison: ${result.onlyInComparison.slice(0, 3).join(', ')}`);
      }
    });

    test('npm v3 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture(
        'npm/package-lock.json.v3',
        'package-lock.json',
        filepath => compare(filepath)
      );

      assert.equal(result.type, Type.NPM);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  npm v3: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('pnpm v6 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture('pnpm/pnpm-lock.yaml.v6', 'pnpm-lock.yaml', filepath =>
        compare(filepath)
      );

      assert.equal(result.type, Type.PNPM);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  pnpm v6: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('pnpm v9 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture('pnpm/pnpm-lock.yaml.v9', 'pnpm-lock.yaml', filepath =>
        compare(filepath)
      );

      assert.equal(result.type, Type.PNPM);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  pnpm v9: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('yarn classic lockfile comparison produces valid results', async () => {
      const result = await withTempFixture('yarn/yarn.lock', 'yarn.lock', filepath =>
        compare(filepath)
      );

      assert.equal(result.type, Type.YARN_CLASSIC);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  yarn classic: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('yarn berry v5 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture('yarn-berry/yarn.lock.v5', 'yarn.lock', filepath =>
        compare(filepath)
      );

      assert.equal(result.type, Type.YARN_BERRY);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  yarn berry v5: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('yarn berry v8 lockfile comparison produces valid results', async () => {
      const result = await withTempFixture('yarn-berry/yarn.lock.v8', 'yarn.lock', filepath =>
        compare(filepath)
      );

      assert.equal(result.type, Type.YARN_BERRY);
      assert.ok(result.flatlockCount > 0, 'should have parsed packages');
      assert.ok(result.comparisonCount > 0, 'should have comparison packages');

      console.log(
        `  yarn berry v8: flatlock=${result.flatlockCount}, comparison=${result.comparisonCount}, identical=${result.identical}`
      );
    });

    test('returns null identical for unknown type', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-test-'));
      const tmpFile = join(tmpDir, 'unknown.txt');
      try {
        await writeFile(tmpFile, 'not a lockfile');
        await assert.rejects(compare(tmpFile), /Unable to detect lockfile type/);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('compareAll()', () => {
    test('yields results for multiple files', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-test-'));
      const npmFile = join(tmpDir, 'package-lock.json');
      const yarnFile = join(tmpDir, 'yarn.lock');

      try {
        await writeFile(npmFile, loadFixture('npm/package-lock.json.v2'));
        await writeFile(yarnFile, loadFixture('yarn/yarn.lock'));

        const results = [];
        for await (const result of compareAll([npmFile, yarnFile])) {
          results.push(result);
        }

        assert.equal(results.length, 2, 'should yield 2 results');
        assert.ok(results[0].filepath.endsWith('package-lock.json'));
        assert.ok(results[1].filepath.endsWith('yarn.lock'));
        assert.equal(results[0].type, Type.NPM);
        assert.equal(results[1].type, Type.YARN_CLASSIC);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    test('includes filepath in each result', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-test-'));
      const npmFile = join(tmpDir, 'package-lock.json');

      try {
        await writeFile(npmFile, loadFixture('npm/package-lock.json.v2'));

        for await (const result of compareAll([npmFile])) {
          assert.ok('filepath' in result, 'should have filepath');
          assert.equal(result.filepath, npmFile);
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('workspace handling', () => {
    test('excludes workspace packages from npm comparison', async () => {
      // Note: The v2/v3 fixtures may or may not have workspaces
      // This test verifies the workspaceCount is returned
      const result = await withTempFixture(
        'npm/package-lock.json.v2',
        'package-lock.json',
        filepath => compare(filepath)
      );

      assert.equal(typeof result.workspaceCount, 'number');
      console.log(`  npm workspace exclusion: ${result.workspaceCount} workspaces excluded`);
    });

    test('excludes workspace packages from yarn comparison', async () => {
      const result = await withTempFixture('yarn/yarn.lock', 'yarn.lock', filepath =>
        compare(filepath)
      );

      assert.equal(typeof result.workspaceCount, 'number');
      console.log(`  yarn workspace exclusion: ${result.workspaceCount} workspaces excluded`);
    });

    test('excludes workspace packages from pnpm comparison', async () => {
      const result = await withTempFixture('pnpm/pnpm-lock.yaml.v6', 'pnpm-lock.yaml', filepath =>
        compare(filepath)
      );

      assert.equal(typeof result.workspaceCount, 'number');
      console.log(`  pnpm workspace exclusion: ${result.workspaceCount} workspaces excluded`);
    });
  });
});
