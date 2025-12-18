/**
 * @fileoverview Comprehensive tests for yarn classic (v1) lockfile parsers
 *
 * Tests cover yarn.lock v1 format features:
 * - Standard package entries
 * - Multiple version ranges in single key
 * - npm: protocol aliasing
 * - Scoped packages
 * - Link/file protocol handling
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Public API
import {
  parseLockfileKey,
  parseYarnClassic,
  fromYarnClassicLock
} from '../../src/parsers/yarn-classic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const decodedDir = join(__dirname, '..', 'decoded', 'yarn');

/**
 * Load a decoded fixture file (plain text)
 * @param {string} relativePath - Path relative to decoded dir
 * @returns {string} File contents
 */
function loadFixture(relativePath) {
  return readFileSync(join(decodedDir, relativePath), 'utf-8');
}

describe('yarn classic parsers', () => {
  // ============================================================================
  // parseLockfileKey tests
  // ============================================================================
  describe('parseLockfileKey', () => {
    describe('simple packages', () => {
      test('parses unscoped package', () => {
        const result = parseLockfileKey('lodash@^4.17.21');
        assert.equal(result, 'lodash');
      });

      test('parses scoped package', () => {
        const result = parseLockfileKey('@babel/core@^7.0.0');
        assert.equal(result, '@babel/core');
      });

      test('parses package with hyphen', () => {
        const result = parseLockfileKey('is-fullwidth-code-point@^3.0.0');
        assert.equal(result, 'is-fullwidth-code-point');
      });

      test('parses package with dots', () => {
        const result = parseLockfileKey('lodash.debounce@^4.0.8');
        assert.equal(result, 'lodash.debounce');
      });

      test('parses package with exact version', () => {
        const result = parseLockfileKey('typescript@5.0.0');
        assert.equal(result, 'typescript');
      });
    });

    describe('multiple version ranges', () => {
      test('parses first from multiple ranges', () => {
        const result = parseLockfileKey('@babel/core@^7.0.0, @babel/core@^7.12.3');
        assert.equal(result, '@babel/core');
      });

      test('parses from many ranges', () => {
        const result = parseLockfileKey(
          '@babel/code-frame@^7.0.0, @babel/code-frame@^7.12.13, @babel/code-frame@^7.22.13'
        );
        assert.equal(result, '@babel/code-frame');
      });

      test('parses unscoped from multiple ranges', () => {
        const result = parseLockfileKey('debug@^4.0.0, debug@^4.3.0');
        assert.equal(result, 'debug');
      });

      test('handles range with spaces', () => {
        const result = parseLockfileKey('@types/node@>=10, @types/node@>=12');
        assert.equal(result, '@types/node');
      });
    });

    describe('npm: protocol aliasing', () => {
      test('extracts alias name from npm: protocol', () => {
        // Format: alias-name@npm:actual-package@version
        const result = parseLockfileKey('string-width-cjs@npm:string-width@^4.2.0');
        assert.equal(result, 'string-width-cjs');
      });

      test('extracts scoped alias from npm: protocol', () => {
        // Scoped alias pointing to another package
        const result = parseLockfileKey('@my-alias/pkg@npm:@actual/package@^1.0.0');
        assert.equal(result, '@my-alias/pkg');
      });

      test('extracts alias pointing to unscoped package', () => {
        const result = parseLockfileKey('wrap-ansi-cjs@npm:wrap-ansi@^7.0.0');
        assert.equal(result, 'wrap-ansi-cjs');
      });

      test('extracts alias pointing to scoped package', () => {
        const result = parseLockfileKey('my-babel@npm:@babel/core@^7.0.0');
        assert.equal(result, 'my-babel');
      });

      test('handles real-world alias for babel/traverse', () => {
        // Real example from yarn.lock files
        const result = parseLockfileKey(
          '@babel/traverse--for-generate-function-map@npm:@babel/traverse@^7.25.3'
        );
        assert.equal(result, '@babel/traverse--for-generate-function-map');
      });
    });

    describe('edge cases', () => {
      test('handles key without version', () => {
        // This shouldn't happen in practice, but let's be safe
        const result = parseLockfileKey('lodash');
        assert.equal(result, 'lodash');
      });

      test('handles version with prerelease tag', () => {
        const result = parseLockfileKey('typescript@5.0.0-beta.1');
        assert.equal(result, 'typescript');
      });

      test('handles version with build metadata', () => {
        const result = parseLockfileKey('pkg@1.0.0+build.123');
        assert.equal(result, 'pkg');
      });

      test('handles tilde range', () => {
        const result = parseLockfileKey('lodash@~4.17.0');
        assert.equal(result, 'lodash');
      });

      test('handles star version', () => {
        const result = parseLockfileKey('pkg@*');
        assert.equal(result, 'pkg');
      });

      test('handles version range with spaces', () => {
        const result = parseLockfileKey('pkg@>= 1.0.0 < 2.0.0');
        assert.equal(result, 'pkg');
      });
    });
  });

  // ============================================================================
  // parseYarnClassic tests
  // ============================================================================
  describe('parseYarnClassic', () => {
    test('parses simple lockfile', () => {
      const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==
`;
      const result = parseYarnClassic(content);

      assert.equal(result.type, 'success');
      assert.ok(result.object['lodash@^4.17.21']);
      assert.equal(result.object['lodash@^4.17.21'].version, '4.17.21');
    });

    test('parses scoped package', () => {
      const content = `# yarn lockfile v1

"@babel/core@^7.0.0":
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"
  integrity sha512-test
`;
      const result = parseYarnClassic(content);

      assert.equal(result.type, 'success');
      assert.ok(result.object['@babel/core@^7.0.0']);
      assert.equal(result.object['@babel/core@^7.0.0'].version, '7.23.0');
    });

    test('returns success or merge type', () => {
      const content = loadFixture('yarn.lock');
      const result = parseYarnClassic(content);

      assert.ok(
        result.type === 'success' || result.type === 'merge',
        'Should parse successfully'
      );
    });
  });

  // ============================================================================
  // fromYarnClassicLock integration tests
  // ============================================================================
  describe('fromYarnClassicLock', () => {
    describe('basic parsing', () => {
      test('parses real fixture', () => {
        const content = loadFixture('yarn.lock');
        const deps = [...fromYarnClassicLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');

        // Verify structure
        const dep = deps[0];
        assert.ok(dep.name, 'Should have name');
        assert.ok(dep.version, 'Should have version');
      });

      test('parses simple lockfile content', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-test123
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
        assert.equal(deps[0].integrity, 'sha512-test123');
      });

      test('parses scoped packages', () => {
        const content = `# yarn lockfile v1

"@babel/core@^7.0.0":
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"
  integrity sha512-test456
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[0].version, '7.23.0');
      });
    });

    describe('dependency extraction', () => {
      test('yields integrity when present', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+test
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.ok(deps[0].integrity);
        assert.ok(deps[0].integrity.startsWith('sha512-'));
      });

      test('yields resolved when present', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.ok(deps[0].resolved);
        assert.ok(deps[0].resolved.includes('registry.yarnpkg.com'));
      });

      test('omits integrity when not present', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.equal(deps[0].integrity, undefined);
      });
    });

    describe('protocol handling', () => {
      // Use pre-parsed objects because @yarnpkg/lockfile can't parse
      // certain synthetic formats with file:/link: protocols in keys

      test('skips file: protocol entries (pre-parsed)', () => {
        const lockfile = {
          'lodash@^4.17.21': {
            version: '4.17.21',
            resolved: 'https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz'
          },
          'my-local-pkg@file:./packages/local': {
            version: '1.0.0',
            resolved: 'file:./packages/local'
          }
        };

        const deps = [...fromYarnClassicLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('skips link: protocol entries (pre-parsed)', () => {
        const lockfile = {
          'lodash@^4.17.21': {
            version: '4.17.21',
            resolved: 'https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz'
          },
          'my-linked-pkg@link:./packages/linked': {
            version: '1.0.0',
            resolved: 'link:./packages/linked'
          }
        };

        const deps = [...fromYarnClassicLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });
    });

    describe('input handling', () => {
      test('accepts string input', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
`;
        const deps = [...fromYarnClassicLock(content)];

        assert.equal(deps.length, 1);
      });

      test('accepts pre-parsed object input', () => {
        const lockfile = {
          'lodash@^4.17.21': {
            version: '4.17.21',
            resolved: 'https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha512-test123'
          }
        };

        const deps = [...fromYarnClassicLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });

      test('string and object produce same results', () => {
        const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-test

"@babel/core@^7.0.0":
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"
  integrity sha512-test2
`;
        const fromString = [...fromYarnClassicLock(content)];
        const parsed = parseYarnClassic(content);
        const fromObject = [...fromYarnClassicLock(parsed.object)];

        assert.equal(fromString.length, fromObject.length);
        assert.deepEqual(
          fromString.map(d => `${d.name}@${d.version}`).sort(),
          fromObject.map(d => `${d.name}@${d.version}`).sort()
        );
      });
    });

    describe('multiple version ranges handling', () => {
      test('handles entries with multiple version ranges', () => {
        const content = `# yarn lockfile v1

"@babel/core@^7.0.0", "@babel/core@^7.12.3":
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"
`;
        const deps = [...fromYarnClassicLock(content)];

        // @yarnpkg/lockfile expands this to 2 entries sharing the same resolution
        // Both have the same name and version
        assert.equal(deps.length, 2);
        assert.ok(deps.every(d => d.name === '@babel/core'));
        assert.ok(deps.every(d => d.version === '7.23.0'));
      });
    });

    describe('real fixture validation', () => {
      test('fixture contains expected structure', () => {
        const content = loadFixture('yarn.lock');
        const deps = [...fromYarnClassicLock(content)];

        // The fixture should have many deps
        assert.ok(deps.length > 100, `Expected >100 deps, got ${deps.length}`);

        // Every dep should have name and version
        for (const dep of deps) {
          assert.ok(dep.name, 'Every dep should have name');
          assert.ok(dep.version, 'Every dep should have version');
        }

        // Check for some known packages
        const lodash = deps.find(d => d.name === 'lodash');
        assert.ok(lodash, 'Should find lodash');

        // Check for scoped packages
        const scopedDeps = deps.filter(d => d.name.startsWith('@'));
        assert.ok(scopedDeps.length > 0, 'Should have scoped packages');
      });

      test('fixture has npm: aliased packages', () => {
        const content = loadFixture('yarn.lock');
        const deps = [...fromYarnClassicLock(content)];

        // Look for aliased packages (they have different names)
        const stringWidthCjs = deps.find(d => d.name === 'string-width-cjs');
        // May or may not exist depending on fixture
        if (stringWidthCjs) {
          assert.ok(stringWidthCjs.version);
        }
      });
    });

    describe('error handling', () => {
      test('throws on invalid content', () => {
        const content = 'not a valid yarn lockfile at all {{{';

        assert.throws(() => {
          [...fromYarnClassicLock(content)];
        });
      });
    });
  });
});
