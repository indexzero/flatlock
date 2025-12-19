/**
 * @fileoverview Comprehensive tests for npm lockfile parsers
 *
 * Tests cover npm package-lock.json formats:
 * - v1 (legacy dependencies format - NOT supported, returns empty)
 * - v2 (current format with packages field)
 * - v3 (same as v2, optimized for npm 7+)
 *
 * Note: This parser only supports v2/v3 format (packages field).
 * v1 format uses dependencies field and is not supported.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Public API
import { parseLockfileKey, fromPackageLock } from '../../src/parsers/npm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const decodedDir = join(__dirname, '..', 'decoded', 'npm');

/**
 * Load a decoded fixture file (plain text)
 * @param {string} relativePath - Path relative to decoded dir
 * @returns {string} File contents
 */
function loadFixture(relativePath) {
  return readFileSync(join(decodedDir, relativePath), 'utf-8');
}

describe('npm parsers', () => {
  // ============================================================================
  // parseLockfileKey tests
  // ============================================================================
  describe('[npm-02] parseLockfileKey', () => {
    describe('simple packages', () => {
      test('parses unscoped package', () => {
        const result = parseLockfileKey('node_modules/lodash');
        assert.equal(result, 'lodash');
      });

      test('parses scoped package', () => {
        const result = parseLockfileKey('node_modules/@babel/core');
        assert.equal(result, '@babel/core');
      });

      test('parses package with hyphen', () => {
        const result = parseLockfileKey('node_modules/is-fullwidth-code-point');
        assert.equal(result, 'is-fullwidth-code-point');
      });

      test('parses package with dots', () => {
        const result = parseLockfileKey('node_modules/lodash.debounce');
        assert.equal(result, 'lodash.debounce');
      });

      test('parses package with numbers', () => {
        const result = parseLockfileKey('node_modules/es6-promise');
        assert.equal(result, 'es6-promise');
      });
    });

    describe('nested node_modules', () => {
      test('parses nested unscoped package', () => {
        const result = parseLockfileKey('node_modules/foo/node_modules/bar');
        assert.equal(result, 'bar');
      });

      test('parses nested scoped package', () => {
        const result = parseLockfileKey('node_modules/foo/node_modules/@babel/core');
        assert.equal(result, '@babel/core');
      });

      test('parses deeply nested package', () => {
        const result = parseLockfileKey(
          'node_modules/a/node_modules/b/node_modules/c/node_modules/@scope/pkg'
        );
        assert.equal(result, '@scope/pkg');
      });

      test('parses scoped parent with nested scoped child', () => {
        const result = parseLockfileKey(
          'node_modules/@parent/pkg/node_modules/@child/dep'
        );
        assert.equal(result, '@child/dep');
      });
    });

    describe('workspace paths', () => {
      test('extracts package from workspace definition path', () => {
        // Workspace definitions use the path without node_modules
        // e.g., "packages/my-lib"
        const result = parseLockfileKey('packages/my-lib');
        assert.equal(result, 'my-lib');
      });

      test('extracts package from deep workspace path', () => {
        const result = parseLockfileKey('packages/tools/eslint-config');
        assert.equal(result, 'eslint-config');
      });

      test('extracts package from workspace nested node_modules', () => {
        const result = parseLockfileKey(
          'packages/my-lib/node_modules/@types/node'
        );
        assert.equal(result, '@types/node');
      });
    });

    describe('edge cases', () => {
      test('handles single segment path', () => {
        const result = parseLockfileKey('lodash');
        assert.equal(result, 'lodash');
      });

      test('handles empty segments', () => {
        // This shouldn't happen in practice, but let's be safe
        const result = parseLockfileKey('node_modules//lodash');
        assert.equal(result, 'lodash');
      });
    });
  });

  // ============================================================================
  // fromPackageLock integration tests
  // ============================================================================
  describe('fromPackageLock', () => {
    describe('[npm-01] version detection', () => {
      test('returns empty for v1 format (uses dependencies, not packages)', () => {
        const content = loadFixture('package-lock.json.v1');
        const deps = [...fromPackageLock(content)];

        // v1 format uses dependencies field, not packages
        // Our parser only supports v2/v3 (packages field)
        assert.equal(deps.length, 0, 'v1 format should return empty (not supported)');
      });

      test('parses v2 format', () => {
        const content = loadFixture('package-lock.json.v2');
        const deps = [...fromPackageLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');

        // Verify structure
        const dep = deps[0];
        assert.ok(dep.name, 'Should have name');
        assert.ok(dep.version, 'Should have version');
      });

      test('parses v3 format', () => {
        const content = loadFixture('package-lock.json.v3');
        const deps = [...fromPackageLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');
      });
    });

    describe('[npm-03, npm-04] dependency extraction', () => {
      test('[npm-03] skips root package (empty path)', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('[npm-04] skips workspace definitions (no node_modules in path)', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'packages/my-lib': { name: 'my-lib', version: '1.0.0' },
            'node_modules/my-lib': { name: 'my-lib', version: '1.0.0', link: true },
            'node_modules/lodash': { version: '4.17.21' }
          }
        };

        const deps = [...fromPackageLock(lockfile)];

        // Should only include lodash and my-lib link (which has version)
        const names = deps.map(d => d.name);
        assert.ok(names.includes('lodash'), 'Should include lodash');
        assert.ok(!names.includes('packages/my-lib'), 'Should skip workspace definition');
      });

      test('yields integrity when present', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': {
              version: '4.17.21',
              integrity: 'sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=='
            }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps[0].integrity, 'sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==');
      });

      test('yields resolved when present', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': {
              version: '4.17.21',
              resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
            }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps[0].resolved, 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz');
      });

      test('[npm-04] yields link flag when true', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/my-lib': {
              version: '1.0.0',
              link: true
            }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps[0].link, true);
      });

      test('handles entries without version (skipped)', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' },
            'node_modules/broken': {} // No version
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('handles empty packages object', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {}
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps.length, 0);
      });

      test('handles missing packages field', () => {
        const lockfile = { lockfileVersion: 2 };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps.length, 0);
      });
    });

    describe('input handling', () => {
      test('accepts JSON string input', () => {
        const content = JSON.stringify({
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' }
          }
        });

        const deps = [...fromPackageLock(content)];
        assert.equal(deps.length, 1);
      });

      test('accepts pre-parsed object input', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        assert.equal(deps.length, 1);
      });

      test('string and object produce same results', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' },
            'node_modules/@babel/core': { version: '7.23.0' }
          }
        };

        const fromString = [...fromPackageLock(JSON.stringify(lockfile))];
        const fromObject = [...fromPackageLock(lockfile)];

        assert.equal(fromString.length, fromObject.length);
        assert.deepEqual(
          fromString.map(d => `${d.name}@${d.version}`).sort(),
          fromObject.map(d => `${d.name}@${d.version}`).sort()
        );
      });
    });

    describe('[npm-06] scoped packages', () => {
      test('[npm-06] parses various scoped packages from v2 fixture', () => {
        const content = loadFixture('package-lock.json.v2');
        const deps = [...fromPackageLock(content)];

        // Find some scoped packages
        const scopedDeps = deps.filter(d => d.name.startsWith('@'));
        assert.ok(scopedDeps.length > 0, 'Should have scoped packages');

        // Verify structure
        for (const dep of scopedDeps) {
          assert.match(dep.name, /^@[^/]+\/[^/]+$/, `${dep.name} should be valid scoped name`);
        }
      });
    });

    describe('[npm-05] nested dependencies', () => {
      test('extracts nested dependencies correctly', () => {
        const lockfile = {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' },
            'node_modules/foo/node_modules/lodash': { version: '4.17.20' }
          }
        };

        const deps = [...fromPackageLock(lockfile)];
        const lodashVersions = deps.filter(d => d.name === 'lodash').map(d => d.version);

        assert.equal(lodashVersions.length, 2);
        assert.ok(lodashVersions.includes('4.17.21'));
        assert.ok(lodashVersions.includes('4.17.20'));
      });
    });

    describe('real fixture validation', () => {
      test('v2 fixture contains expected structure', () => {
        const content = loadFixture('package-lock.json.v2');
        const deps = [...fromPackageLock(content)];

        // The v2 fixture is from http-server which has many deps
        assert.ok(deps.length > 50, `Expected >50 deps, got ${deps.length}`);

        // Every dep should have name and version
        for (const dep of deps) {
          assert.ok(dep.name, 'Every dep should have name');
          assert.ok(dep.version, 'Every dep should have version');
        }

        // Most deps should have integrity
        const withIntegrity = deps.filter(d => d.integrity);
        assert.ok(
          withIntegrity.length > deps.length * 0.9,
          'Most deps should have integrity'
        );
      });

      test('v3 fixture contains expected structure', () => {
        const content = loadFixture('package-lock.json.v3');
        const deps = [...fromPackageLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');

        // Every dep should have name and version
        for (const dep of deps) {
          assert.ok(dep.name, 'Every dep should have name');
          assert.ok(dep.version, 'Every dep should have version');
        }
      });
    });
  });
});
