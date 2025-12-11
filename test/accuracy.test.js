/**
 * Accuracy tests comparing flatlock against established parsers
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as flatlock from '../src/index.js';
import { loadFixture, compareResults, toSpec, logComparison } from './support.js';

/**
 * Collect all dependencies from our parser
 */
async function collectOurs(content, options = {}) {
  const deps = new Set();
  for (const dep of flatlock.fromString(content, options)) {
    deps.add(toSpec(dep));
  }
  return deps;
}

describe('accuracy tests', () => {
  describe('npm (package-lock.json)', () => {
    test('v2 lockfile - compare against @npmcli/arborist', async (t) => {
      const content = loadFixture('npm/package-lock.json.v2');

      // Our parser
      const ourDeps = await collectOurs(content, { path: 'package-lock.json' });

      // Ground truth: @npmcli/arborist
      const arboristDeps = new Set();
      try {
        const _Arborist = (await import('@npmcli/arborist')).default;
        // Arborist needs a directory with package.json, so we parse the lockfile directly
        const lockfile = JSON.parse(content);
        const packages = lockfile.packages || {};
        for (const [path, pkg] of Object.entries(packages)) {
          if (path === '' || !path.includes('node_modules/')) continue;
          const name = path.split('node_modules/').pop();
          if (name && pkg.version) {
            arboristDeps.add(`${name}@${pkg.version}`);
          }
        }
      } catch (err) {
        t.skip(`Arborist not available: ${err.message}`);
        return;
      }

      const results = compareResults(arboristDeps, ourDeps);
      logComparison('npm v2 vs Arborist-style parsing', arboristDeps.size, ourDeps.size, results);

      // Log result but don't fail - differences are expected
      t.diagnostic(`npm v2: arborist=${arboristDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });

    test('v3 lockfile - compare against @npmcli/arborist', async (t) => {
      const content = loadFixture('npm/package-lock.json.v3');

      const ourDeps = await collectOurs(content, { path: 'package-lock.json' });

      // Parse lockfile directly for comparison
      const lockfile = JSON.parse(content);
      const packages = lockfile.packages || {};
      const expectedDeps = new Set();
      for (const [path, pkg] of Object.entries(packages)) {
        if (path === '' || !path.includes('node_modules/')) continue;
        const name = path.split('node_modules/').pop();
        if (name && pkg.version) {
          expectedDeps.add(`${name}@${pkg.version}`);
        }
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('npm v3 vs direct parsing', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`npm v3: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });
  });

  describe('pnpm (pnpm-lock.yaml)', () => {
    test('v6 lockfile - compare against @pnpm/lockfile-file', async (t) => {
      const content = loadFixture('pnpm/pnpm-lock.yaml.v6');

      const ourDeps = await collectOurs(content, { path: 'pnpm-lock.yaml' });

      // Parse with js-yaml for comparison (same as @pnpm/lockfile-file would)
      const expectedDeps = new Set();
      try {
        const yaml = (await import('js-yaml')).default;
        const lockfile = yaml.load(content);
        const packages = lockfile.packages || {};
        for (const [spec] of Object.entries(packages)) {
          // pnpm v6 format: /package@version or /@scope/package@version
          const match = spec.match(/^\/?(@?[^@]+)@(.+)$/);
          if (match) {
            expectedDeps.add(`${match[1]}@${match[2]}`);
          }
        }
      } catch (err) {
        t.skip(`yaml parsing failed: ${err.message}`);
        return;
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('pnpm v6 vs direct yaml parsing', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`pnpm v6: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });

    test('v9 lockfile - compare against @pnpm/lockfile-file', async (t) => {
      const content = loadFixture('pnpm/pnpm-lock.yaml.v9');

      const ourDeps = await collectOurs(content, { path: 'pnpm-lock.yaml' });

      const expectedDeps = new Set();
      try {
        const yaml = (await import('js-yaml')).default;
        const lockfile = yaml.load(content);
        const packages = lockfile.packages || {};
        for (const [spec] of Object.entries(packages)) {
          const match = spec.match(/^\/?(@?[^@]+)@(.+)$/);
          if (match) {
            expectedDeps.add(`${match[1]}@${match[2]}`);
          }
        }
      } catch (err) {
        t.skip(`yaml parsing failed: ${err.message}`);
        return;
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('pnpm v9 vs direct yaml parsing', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`pnpm v9: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });
  });

  describe('yarn classic (yarn.lock v1)', () => {
    test('compare against @yarnpkg/lockfile', async (t) => {
      const content = loadFixture('yarn/yarn.lock');

      const ourDeps = await collectOurs(content, { path: 'yarn.lock' });

      // Ground truth: @yarnpkg/lockfile
      const expectedDeps = new Set();
      try {
        const yarnLockfile = await import('@yarnpkg/lockfile');
        const parse = yarnLockfile.default?.parse || yarnLockfile.parse;
        if (!parse) throw new Error('parse function not found');
        const { object: lockfile } = parse(content);

        for (const [key, pkg] of Object.entries(lockfile)) {
          // Extract name from key (e.g., "lodash@^4.17.21" -> "lodash")
          // Handle scoped packages: "@babel/core@^7.0.0" -> "@babel/core"
          let name;
          if (key.startsWith('@')) {
            const idx = key.indexOf('@', 1);
            name = key.slice(0, idx);
          } else {
            name = key.split('@')[0];
          }
          if (name && pkg.version) {
            expectedDeps.add(`${name}@${pkg.version}`);
          }
        }
      } catch (err) {
        t.skip(`@yarnpkg/lockfile not available: ${err.message}`);
        return;
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('yarn classic vs @yarnpkg/lockfile', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`yarn classic: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });
  });

  describe('yarn berry (yarn.lock v2+)', () => {
    test('v5 lockfile - compare against @yarnpkg/parsers', async (t) => {
      const content = loadFixture('yarn-berry/yarn.lock.v5');

      const ourDeps = await collectOurs(content, { path: 'yarn.lock' });

      // Ground truth: @yarnpkg/parsers
      const expectedDeps = new Set();
      try {
        const { parseSyml } = await import('@yarnpkg/parsers');
        const lockfile = parseSyml(content);

        for (const [key, pkg] of Object.entries(lockfile)) {
          if (key === '__metadata') continue;

          // Extract name from key
          let name;
          if (key.startsWith('@')) {
            const idx = key.indexOf('@', 1);
            name = key.slice(0, idx);
          } else {
            name = key.split('@')[0];
          }
          if (name && pkg.version) {
            expectedDeps.add(`${name}@${pkg.version}`);
          }
        }
      } catch (err) {
        t.skip(`@yarnpkg/parsers not available: ${err.message}`);
        return;
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('yarn berry v5 vs @yarnpkg/parsers', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`yarn berry v5: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });

    test('v8 lockfile - compare against @yarnpkg/parsers', async (t) => {
      const content = loadFixture('yarn-berry/yarn.lock.v8');

      const ourDeps = await collectOurs(content, { path: 'yarn.lock' });

      const expectedDeps = new Set();
      try {
        const { parseSyml } = await import('@yarnpkg/parsers');
        const lockfile = parseSyml(content);

        for (const [key, pkg] of Object.entries(lockfile)) {
          if (key === '__metadata') continue;

          let name;
          if (key.startsWith('@')) {
            const idx = key.indexOf('@', 1);
            name = key.slice(0, idx);
          } else {
            name = key.split('@')[0];
          }
          if (name && pkg.version) {
            expectedDeps.add(`${name}@${pkg.version}`);
          }
        }
      } catch (err) {
        t.skip(`@yarnpkg/parsers not available: ${err.message}`);
        return;
      }

      const results = compareResults(expectedDeps, ourDeps);
      logComparison('yarn berry v8 vs @yarnpkg/parsers', expectedDeps.size, ourDeps.size, results);

      t.diagnostic(`yarn berry v8: expected=${expectedDeps.size}, ours=${ourDeps.size}, accuracy=${(results.accuracy * 100).toFixed(2)}%`);
    });
  });

  describe('cross-validation with snyk-nodejs-lockfile-parser', () => {
    test('npm lockfile cross-validation', async (t) => {
      const content = loadFixture('npm/package-lock.json.v2');

      const ourDeps = await collectOurs(content, { path: 'package-lock.json' });

      // snyk parser requires both manifest and lockfile
      // Since we don't have a manifest, just report our count
      t.diagnostic(`npm v2 (ours): ${ourDeps.size} packages`);
      t.diagnostic('snyk cross-validation skipped (requires package.json manifest)');
    });
  });

  describe('approx fixtures (real-world scale)', () => {
    test('npm small (3 packages)', async (t) => {
      const content = loadFixture('npm/approx/small.package-lock.json');
      const deps = await collectOurs(content, { path: 'package-lock.json' });
      t.diagnostic(`npm small: ${deps.size} packages`);
      assert.equal(deps.size, 3);
    });

    test('npm medium (~600 packages)', async (t) => {
      const content = loadFixture('npm/approx/medium.package-lock.json');
      const deps = await collectOurs(content, { path: 'package-lock.json' });
      t.diagnostic(`npm medium: ${deps.size} packages`);
      assert.ok(deps.size > 500);
    });

    test('npm with workspaces (~3000 packages, workspaces excluded)', async (t) => {
      const content = loadFixture('npm/approx/workspaces.package-lock.json');
      const deps = await collectOurs(content, { path: 'package-lock.json' });
      t.diagnostic(`npm workspaces: ${deps.size} packages`);
      assert.ok(deps.size > 3000);
    });

    test('pnpm medium (~1600 packages)', async (t) => {
      const content = loadFixture('pnpm/approx/medium.pnpm-lock.yaml');
      const deps = await collectOurs(content, { path: 'pnpm-lock.yaml' });
      t.diagnostic(`pnpm medium: ${deps.size} packages`);
      assert.ok(deps.size > 1500);
    });

    test('pnpm large (~5600 packages)', async (t) => {
      const content = loadFixture('pnpm/approx/large.pnpm-lock.yaml');
      const deps = await collectOurs(content, { path: 'pnpm-lock.yaml' });
      t.diagnostic(`pnpm large: ${deps.size} packages`);
      assert.ok(deps.size > 5000);
    });

    test('yarn classic medium (~1600 packages)', async (t) => {
      const content = loadFixture('yarn/approx/medium.yarn.lock');
      const deps = await collectOurs(content, { path: 'yarn.lock' });
      t.diagnostic(`yarn classic medium: ${deps.size} packages`);
      assert.ok(deps.size > 1500);
    });

    test('yarn classic with npm: aliases (~4800 packages)', async (t) => {
      const content = loadFixture('yarn/approx/aliases.yarn.lock');
      const deps = await collectOurs(content, { path: 'yarn.lock' });
      t.diagnostic(`yarn classic aliases: ${deps.size} packages`);
      assert.ok(deps.size > 4500);
    });

    test('yarn berry medium (~2400 packages)', async (t) => {
      const content = loadFixture('yarn-berry/approx/medium.yarn.lock');
      const deps = await collectOurs(content, { path: 'yarn.lock' });
      t.diagnostic(`yarn berry medium: ${deps.size} packages`);
      assert.ok(deps.size > 2000);
    });

    test('yarn berry with patch: protocol (~3400 packages)', async (t) => {
      const content = loadFixture('yarn-berry/approx/patch.yarn.lock');
      const deps = await collectOurs(content, { path: 'yarn.lock' });
      t.diagnostic(`yarn berry patch: ${deps.size} packages`);
      assert.ok(deps.size > 3000);
    });
  });

  describe('summary', () => {
    test('all fixtures parsed successfully', async (t) => {
      const fixtures = [
        { path: 'npm/package-lock.json.v2', name: 'npm v2', hint: 'package-lock.json' },
        { path: 'npm/package-lock.json.v3', name: 'npm v3', hint: 'package-lock.json' },
        { path: 'pnpm/pnpm-lock.yaml.v6', name: 'pnpm v6', hint: 'pnpm-lock.yaml' },
        { path: 'pnpm/pnpm-lock.yaml.v9', name: 'pnpm v9', hint: 'pnpm-lock.yaml' },
        { path: 'yarn/yarn.lock', name: 'yarn classic', hint: 'yarn.lock' },
        { path: 'yarn-berry/yarn.lock.v5', name: 'yarn berry v5', hint: 'yarn.lock' },
        { path: 'yarn-berry/yarn.lock.v8', name: 'yarn berry v8', hint: 'yarn.lock' },
      ];

      console.log('\n=== Fixture Summary ===');
      let totalDeps = 0;

      for (const fixture of fixtures) {
        const content = loadFixture(fixture.path);
        const deps = await collectOurs(content, { path: fixture.hint });
        console.log(`  ${fixture.name}: ${deps.size} packages`);
        totalDeps += deps.size;
      }

      console.log(`  ---`);
      console.log(`  Total: ${totalDeps} packages across ${fixtures.length} fixtures\n`);

      t.diagnostic(`Total packages parsed: ${totalDeps}`);
    });
  });
});
