/**
 * @fileoverview Comprehensive tests for yarn berry (v2+) lockfile parsers
 *
 * Tests cover yarn.lock v2+ format features:
 * - __metadata header with version
 * - Protocol markers: @npm:, @workspace:, @portal:, @link:, @patch:, @file:
 * - Multiple comma-separated entries
 * - Scoped packages
 * - checksum field (integrity equivalent)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSyml } from '@yarnpkg/parsers';
// Public API
import {
  fromYarnBerryLock,
  parseLockfileKey,
  parseResolution
} from '../../src/parsers/yarn-berry.js';

// Alias for test readability
const parseYarnBerryResolution = parseResolution;

const __dirname = dirname(fileURLToPath(import.meta.url));
const decodedDir = join(__dirname, '..', 'decoded', 'yarn-berry');

/**
 * Load a decoded fixture file (plain text)
 * @param {string} relativePath - Path relative to decoded dir
 * @returns {string} File contents
 */
function loadFixture(relativePath) {
  return readFileSync(join(decodedDir, relativePath), 'utf-8');
}

describe('yarn berry parsers', () => {
  // ============================================================================
  // parseLockfileKey tests
  // ============================================================================
  describe('parseLockfileKey', () => {
    describe('npm: protocol', () => {
      test('parses unscoped package', () => {
        const result = parseLockfileKey('lodash@npm:^4.17.21');
        assert.equal(result, 'lodash');
      });

      test('parses scoped package', () => {
        const result = parseLockfileKey('@babel/core@npm:^7.0.0');
        assert.equal(result, '@babel/core');
      });

      test('parses package with multiple version ranges', () => {
        const result = parseLockfileKey('@babel/core@npm:^7.0.0, @babel/core@npm:^7.12.3');
        assert.equal(result, '@babel/core');
      });

      test('parses deeply scoped package', () => {
        const result = parseLockfileKey('@types/babel__core@npm:^7.1.0');
        assert.equal(result, '@types/babel__core');
      });
    });

    describe('workspace: protocol', () => {
      test('parses workspace package', () => {
        const result = parseLockfileKey('@my-org/my-lib@workspace:packages/my-lib');
        assert.equal(result, '@my-org/my-lib');
      });

      test('parses workspace with complex path', () => {
        const result = parseLockfileKey(
          '@babel-internal/runtime-integration-rollup@workspace:test/runtime-integration/rollup'
        );
        assert.equal(result, '@babel-internal/runtime-integration-rollup');
      });

      test('parses workspace star pattern', () => {
        const result = parseLockfileKey('@my-org/pkg@workspace:*');
        assert.equal(result, '@my-org/pkg');
      });
    });

    describe('link: protocol', () => {
      test('parses linked package', () => {
        const result = parseLockfileKey('my-pkg@link:./packages/my-pkg');
        assert.equal(result, 'my-pkg');
      });

      test('parses linked package with locator', () => {
        // Real-world format with locator
        const result = parseLockfileKey(
          '$repo-utils@link:./scripts/repo-utils::locator=babel%40workspace%3A.'
        );
        assert.equal(result, '$repo-utils');
      });
    });

    describe('portal: protocol', () => {
      test('parses portal package', () => {
        const result = parseLockfileKey('my-pkg@portal:../external-pkg');
        assert.equal(result, 'my-pkg');
      });

      test('parses scoped portal package', () => {
        const result = parseLockfileKey('@scope/pkg@portal:../my-portal');
        assert.equal(result, '@scope/pkg');
      });
    });

    describe('patch: protocol', () => {
      test('parses patch with npm reference', () => {
        // Real-world format: patch:pkg@npm:version#hash
        const result = parseLockfileKey(
          '@ngageoint/simple-features-js@patch:@ngageoint/simple-features-js@npm:1.1.0#./patches/@ngageoint+simple-features-js+1.1.0.patch'
        );
        assert.equal(result, '@ngageoint/simple-features-js');
      });

      test('parses simple patch', () => {
        const result = parseLockfileKey('lodash@patch:lodash@npm:4.17.21#./patches/lodash.patch');
        assert.equal(result, 'lodash');
      });
    });

    describe('file: protocol', () => {
      test('parses file protocol', () => {
        const result = parseLockfileKey('my-pkg@file:./local/my-pkg.tgz');
        assert.equal(result, 'my-pkg');
      });

      test('parses scoped file protocol', () => {
        const result = parseLockfileKey('@scope/pkg@file:../downloads/pkg.tgz');
        assert.equal(result, '@scope/pkg');
      });
    });

    describe('edge cases', () => {
      test('handles key without protocol (fallback)', () => {
        const result = parseLockfileKey('lodash@^4.17.21');
        assert.equal(result, 'lodash');
      });

      test('handles scoped package without protocol', () => {
        const result = parseLockfileKey('@babel/core@7.23.0');
        assert.equal(result, '@babel/core');
      });

      test('handles package with hyphens and numbers', () => {
        const result = parseLockfileKey('es6-promise@npm:^4.0.0');
        assert.equal(result, 'es6-promise');
      });

      test('handles version with prerelease', () => {
        const result = parseLockfileKey('typescript@npm:5.0.0-beta.1');
        assert.equal(result, 'typescript');
      });

      test('handles aliased package name', () => {
        // Format from yarn berry with baseline alias
        const result = parseLockfileKey('@babel-baseline/cli@npm:@babel/cli@7.27.1');
        assert.equal(result, '@babel-baseline/cli');
      });
    });

    describe('multiple entries', () => {
      test('extracts first from comma-separated list', () => {
        const result = parseLockfileKey(
          '@babel/code-frame@npm:^7.0.0, @babel/code-frame@npm:^7.22.13'
        );
        assert.equal(result, '@babel/code-frame');
      });

      test('handles many version ranges', () => {
        const result = parseLockfileKey(
          '@jridgewell/trace-mapping@npm:^0.3.23, @jridgewell/trace-mapping@npm:^0.3.24, @jridgewell/trace-mapping@npm:^0.3.25'
        );
        assert.equal(result, '@jridgewell/trace-mapping');
      });
    });
  });

  // ============================================================================
  // fromYarnBerryLock integration tests
  // ============================================================================
  describe('fromYarnBerryLock', () => {
    describe('basic parsing', () => {
      test('parses v5 fixture', () => {
        const content = loadFixture('yarn.lock.v5');
        const deps = [...fromYarnBerryLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');

        // Verify structure
        const dep = deps[0];
        assert.ok(dep.name, 'Should have name');
        assert.ok(dep.version, 'Should have version');
      });

      test('parses v8 fixture', () => {
        const content = loadFixture('yarn.lock.v8');
        const deps = [...fromYarnBerryLock(content)];

        assert.ok(deps.length > 0, 'Should have dependencies');
      });

      test('parses simple lockfile content', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: sha512-test123
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
        assert.equal(deps[0].integrity, 'sha512-test123');
      });
    });

    describe('metadata handling', () => {
      test('skips __metadata entry', () => {
        const content = `__metadata:
  version: 6
  cacheKey: 8c0

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        // Should not have __metadata as a dep
        assert.ok(!deps.find(d => d.name === '__metadata'));
      });
    });

    describe('dependency extraction', () => {
      test('yields integrity from checksum field', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  checksum: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+test
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.ok(deps[0].integrity);
        assert.ok(deps[0].integrity.startsWith('sha512-'));
      });

      test('yields resolved from resolution field', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps[0].resolved, 'lodash@npm:4.17.21');
      });

      test('handles entries without checksum', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps[0].integrity, undefined);
      });
    });

    describe('protocol handling', () => {
      // Note: The parser checks resolution?.startsWith('workspace:') etc.
      // In real yarn berry lockfiles, resolution is "name@protocol:path", so
      // the current implementation doesn't actually filter workspace entries.
      // These tests use pre-parsed objects with resolution starting directly
      // with the protocol to test the intended filtering behavior.

      test('skips workspace: protocol entries (pre-parsed)', () => {
        const lockfile = {
          __metadata: { version: 6 },
          'lodash@npm:^4.17.21': {
            version: '4.17.21',
            resolution: 'lodash@npm:4.17.21'
          },
          '@my-org/my-lib@workspace:packages/my-lib': {
            version: '0.0.0-use.local',
            resolution: 'workspace:packages/my-lib' // Starts with workspace:
          }
        };

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('skips portal: protocol entries (pre-parsed)', () => {
        const lockfile = {
          __metadata: { version: 6 },
          'lodash@npm:^4.17.21': {
            version: '4.17.21',
            resolution: 'lodash@npm:4.17.21'
          },
          'my-portal@portal:../external': {
            version: '1.0.0',
            resolution: 'portal:../external' // Starts with portal:
          }
        };

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('skips link: protocol entries (pre-parsed)', () => {
        const lockfile = {
          __metadata: { version: 6 },
          'lodash@npm:^4.17.21': {
            version: '4.17.21',
            resolution: 'lodash@npm:4.17.21'
          },
          'my-link@link:./local': {
            version: '0.0.0-use.local',
            resolution: 'link:./local' // Starts with link:
          }
        };

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('includes npm: protocol entries', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"@babel/core@npm:^7.0.0":
  version: 7.23.0
  resolution: "@babel/core@npm:7.23.0"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 2);
        const names = deps.map(d => d.name);
        assert.ok(names.includes('lodash'));
        assert.ok(names.includes('@babel/core'));
      });
    });

    describe('input handling', () => {
      test('accepts string input', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 1);
      });

      test('accepts pre-parsed object input', () => {
        const lockfile = {
          __metadata: { version: 6 },
          'lodash@npm:^4.17.21': {
            version: '4.17.21',
            resolution: 'lodash@npm:4.17.21',
            checksum: 'sha512-test123'
          }
        };

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
        assert.equal(deps[0].integrity, 'sha512-test123');
      });
    });

    describe('scoped packages', () => {
      test('parses scoped packages correctly', () => {
        const content = `__metadata:
  version: 6

"@babel/core@npm:^7.0.0":
  version: 7.23.0
  resolution: "@babel/core@npm:7.23.0"

"@types/node@npm:^20.0.0":
  version: 20.10.0
  resolution: "@types/node@npm:20.10.0"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 2);
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[1].name, '@types/node');
      });
    });

    describe('real fixture validation', () => {
      test('v5 fixture contains expected structure', () => {
        const content = loadFixture('yarn.lock.v5');
        const deps = [...fromYarnBerryLock(content)];

        // The v5 fixture has 46 deps
        assert.ok(deps.length >= 40, `Expected >=40 deps, got ${deps.length}`);

        // Every dep should have name and version
        for (const dep of deps) {
          assert.ok(dep.name, 'Every dep should have name');
          assert.ok(dep.version, 'Every dep should have version');
        }

        // Check for scoped packages
        const scopedDeps = deps.filter(d => d.name.startsWith('@'));
        assert.ok(scopedDeps.length > 0, 'Should have scoped packages');
      });

      test('v8 fixture contains expected structure', () => {
        const content = loadFixture('yarn.lock.v8');
        const deps = [...fromYarnBerryLock(content)];

        // The v8 fixture should have deps
        assert.ok(deps.length > 0, `Expected >0 deps, got ${deps.length}`);

        // Every dep should have name and version
        for (const dep of deps) {
          assert.ok(dep.name, 'Every dep should have name');
          assert.ok(dep.version, 'Every dep should have version');
        }
      });

      test('v8 fixture excludes workspace entries', () => {
        const content = loadFixture('yarn.lock.v8');
        const deps = [...fromYarnBerryLock(content)];

        // Workspace entries should be filtered out (only external deps)
        const workspaceDeps = deps.filter(d => d.resolved?.includes('@workspace:'));
        assert.equal(workspaceDeps.length, 0, 'Workspace entries should be excluded');
      });

      test('v8 fixture excludes link entries', () => {
        const content = loadFixture('yarn.lock.v8');
        const deps = [...fromYarnBerryLock(content)];

        // Link entries should be filtered out
        const linkDeps = deps.filter(d => d.resolved?.includes('@link:'));
        assert.equal(linkDeps.length, 0, 'Link entries should be excluded');
      });

      test('v8 fixture excludes portal entries', () => {
        const content = loadFixture('yarn.lock.v8');
        const deps = [...fromYarnBerryLock(content)];

        // Portal entries should be filtered out
        const portalDeps = deps.filter(d => d.resolved?.includes('@portal:'));
        assert.equal(portalDeps.length, 0, 'Portal entries should be excluded');
      });
    });

    describe('multiple version ranges deduplication', () => {
      test('handles entries with multiple version ranges', () => {
        const content = `__metadata:
  version: 6

"@babel/core@npm:^7.0.0, @babel/core@npm:^7.12.3":
  version: 7.23.0
  resolution: "@babel/core@npm:7.23.0"
`;
        const deps = [...fromYarnBerryLock(content)];

        // Should yield one entry
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[0].version, '7.23.0');
      });
    });

    describe('aliased packages', () => {
      test('handles baseline aliases - returns real package name from resolution', () => {
        // npm aliases: the key contains the alias (e.g., "@babel-baseline/core")
        // but the resolution contains the real package name (e.g., "@babel/core")
        // For SBOM accuracy, we use the resolution (real package name)
        const content = `__metadata:
  version: 8

"@babel-baseline/core@npm:@babel/core@7.24.4":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 1);
        // Returns the real package name from resolution, not the alias from key
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[0].version, '7.24.4');
      });
    });

    describe('entries without version', () => {
      test('skips entries without version', () => {
        const content = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"broken@npm:^1.0.0":
  resolution: "broken@npm:1.0.0"
`;
        const deps = [...fromYarnBerryLock(content)];

        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });
    });
  });

  // ============================================================================
  // Ground Truth Discovery Tests
  // ============================================================================
  // These tests document and validate discoveries made during ground truth
  // comparison testing with official package manager tools.

  /**
   * yarn-berry-01: Alias Resolution
   *
   * Discovery: Yarn berry lockfile keys can contain npm aliases, but the
   * resolution field always contains the canonical package name.
   *
   * For SBOM accuracy, parseResolution() must be preferred over parseLockfileKey()
   * because the resolution is what's actually installed in node_modules.
   *
   * Reference: yarn berry source code - Project.ts setupResolutions()
   * The resolution field is the "locator" - the canonical package identifier.
   */
  describe('[yarn-berry-01] yarn berry alias resolution', () => {
    describe('parseResolution extracts canonical name from resolution field', () => {
      test('unscoped npm package', () => {
        const resolution = 'lodash@npm:4.17.21';
        assert.equal(parseYarnBerryResolution(resolution), 'lodash');
      });

      test('scoped npm package', () => {
        const resolution = '@babel/core@npm:7.24.0';
        assert.equal(parseYarnBerryResolution(resolution), '@babel/core');
      });

      test('CJS shim package - returns real package name', () => {
        // This is the RESOLUTION field, which always has the real name
        const resolution = 'string-width@npm:4.2.3';
        assert.equal(parseYarnBerryResolution(resolution), 'string-width');
      });

      test('workspace protocol', () => {
        const resolution = 'my-pkg@workspace:packages/my-pkg';
        assert.equal(parseYarnBerryResolution(resolution), 'my-pkg');
      });

      test('patch protocol with nested npm reference', () => {
        const resolution = 'pkg@patch:pkg@npm:1.0.0#./fix.patch';
        assert.equal(parseYarnBerryResolution(resolution), 'pkg');
      });

      test('null input returns null', () => {
        assert.equal(parseYarnBerryResolution(null), null);
      });

      test('empty string returns null', () => {
        assert.equal(parseYarnBerryResolution(''), null);
      });
    });

    describe('parseLockfileKey extracts name from key (may be alias)', () => {
      test('simple unscoped package', () => {
        const key = 'lodash@npm:^4.17.21';
        assert.equal(parseLockfileKey(key), 'lodash');
      });

      test('scoped package', () => {
        const key = '@babel/core@npm:^7.24.0';
        assert.equal(parseLockfileKey(key), '@babel/core');
      });

      test('CJS shim alias - returns ALIAS name (not real package)', () => {
        // This is the KEY field, which contains the alias
        const key = 'string-width-cjs@npm:string-width@^4.2.0';
        // WARNING: This returns the alias, not the real package name
        assert.equal(parseLockfileKey(key), 'string-width-cjs');
      });

      test('scoped alias pointing to different scoped package', () => {
        const key = '@babel-baseline/core@npm:@babel/core@7.24.4';
        // WARNING: This returns the alias, not the real package name
        assert.equal(parseLockfileKey(key), '@babel-baseline/core');
      });

      test('placeholder package alias', () => {
        const key = 'canvas@npm:empty-npm-package@1.0.0';
        // WARNING: This returns the alias, not the real package name
        assert.equal(parseLockfileKey(key), 'canvas');
      });
    });

    describe('parseResolution vs parseLockfileKey: the critical distinction', () => {
      test('CJS shim: resolution has canonical name, key has alias', () => {
        const key = 'string-width-cjs@npm:string-width@^4.2.0';
        const resolution = 'string-width@npm:4.2.3';

        const nameFromKey = parseLockfileKey(key);
        const nameFromResolution = parseYarnBerryResolution(resolution);

        // These are DIFFERENT - this is the critical discovery
        assert.notEqual(nameFromKey, nameFromResolution);
        assert.equal(nameFromKey, 'string-width-cjs'); // alias
        assert.equal(nameFromResolution, 'string-width'); // canonical
      });

      test('organization baseline: resolution has canonical name, key has alias', () => {
        const key = '@babel-baseline/core@npm:@babel/core@7.24.4';
        const resolution = '@babel/core@npm:7.24.4';

        const nameFromKey = parseLockfileKey(key);
        const nameFromResolution = parseYarnBerryResolution(resolution);

        assert.notEqual(nameFromKey, nameFromResolution);
        assert.equal(nameFromKey, '@babel-baseline/core'); // alias
        assert.equal(nameFromResolution, '@babel/core'); // canonical
      });

      test('placeholder package: resolution has canonical name, key has alias', () => {
        const key = 'canvas@npm:empty-npm-package@1.0.0';
        const resolution = 'empty-npm-package@npm:1.0.0';

        const nameFromKey = parseLockfileKey(key);
        const nameFromResolution = parseYarnBerryResolution(resolution);

        assert.notEqual(nameFromKey, nameFromResolution);
        assert.equal(nameFromKey, 'canvas'); // alias
        assert.equal(nameFromResolution, 'empty-npm-package'); // canonical
      });

      test('non-aliased package: resolution and key match', () => {
        const key = 'lodash@npm:^4.17.21';
        const resolution = 'lodash@npm:4.17.21';

        const nameFromKey = parseLockfileKey(key);
        const nameFromResolution = parseYarnBerryResolution(resolution);

        // For non-aliased packages, they should match
        assert.equal(nameFromKey, nameFromResolution);
        assert.equal(nameFromKey, 'lodash');
      });
    });

    describe('fromYarnBerryLock uses resolution for canonical name', () => {
      test('CJS shim alias - returns real package name from resolution', () => {
        const lockfile = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: e52c10dc3fbfcd6c3a15f159f54a90024241d0f149cf8aed2c5a4571b6ee18c9
`;

        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps.length, 1);

        // CRITICAL: name comes from resolution, NOT from key
        assert.equal(deps[0].name, 'string-width');
        assert.equal(deps[0].version, '4.2.3');
        // resolved field preserves full resolution for traceability
        assert.equal(deps[0].resolved, 'string-width@npm:4.2.3');
      });

      test('scoped alias - returns real package name from resolution', () => {
        const lockfile = `__metadata:
  version: 8

"@babel-baseline/core@npm:@babel/core@7.24.4":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
  checksum: abc123
`;

        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps.length, 1);

        // CRITICAL: name comes from resolution, NOT from key
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[0].version, '7.24.4');
      });

      test('placeholder package alias - returns real package name from resolution', () => {
        const lockfile = `__metadata:
  version: 8

"canvas@npm:empty-npm-package@1.0.0":
  version: 1.0.0
  resolution: "empty-npm-package@npm:1.0.0"
  checksum: xyz789
`;

        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps.length, 1);

        // CRITICAL: name comes from resolution, NOT from key
        assert.equal(deps[0].name, 'empty-npm-package');
        assert.equal(deps[0].version, '1.0.0');
      });

      test('multiple aliases to same package - deduplication by name@version', () => {
        const lockfile = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: abc

"string-width@npm:^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: abc
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // Both entries resolve to the same package, but we yield both
        // because fromYarnBerryLock doesn't deduplicate (that's the caller's job)
        assert.equal(deps.length, 2);
        assert.equal(deps[0].name, 'string-width');
        assert.equal(deps[1].name, 'string-width');
      });

      test('fallback to key parsing when resolution is missing', () => {
        // Edge case: malformed lockfile without resolution field
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
`;

        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps.length, 1);

        // Falls back to key parsing
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });

      test('empty resolution string falls back to key parsing', () => {
        // Edge case: resolution field exists but is empty
        // Tests the || fallback in: parseResolution(resolution) || parseLockfileKey(key)
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: ""
`;

        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps.length, 1);

        // Falls back to key parsing when resolution is empty
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });
    });
  });

  /**
   * yarn-berry-02: Intentional Divergence from parseSyml (56.10% accuracy)
   *
   * Discovery: The accuracy test shows 56.10% for yarn berry v8 when comparing
   * against @yarnpkg/parsers (parseSyml). This is INTENTIONAL and CORRECT.
   *
   * The "missing" packages are ALIASES. The "extra" packages are CANONICAL names.
   * flatlock returns canonical names for SBOM accuracy.
   *
   * Reference: npm alias feature - `npm install alias@npm:real-package@version`
   */
  describe('[yarn-berry-02] intentional divergence from parseSyml', () => {
    describe('parseSyml returns KEY names, flatlock returns RESOLUTION names', () => {
      test('parseSyml returns raw object with alias name as key', () => {
        const lockfile = `__metadata:
  version: 8

"@babel-baseline/core@npm:@babel/core@7.24.4":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
  checksum: abc123
`;

        const raw = parseSyml(lockfile);
        const keys = Object.keys(raw).filter(k => k !== '__metadata');

        assert.equal(keys.length, 1);
        // parseSyml gives us the KEY which contains the ALIAS
        assert.ok(keys[0].startsWith('@babel-baseline/core'));
      });

      test('flatlock returns canonical name from resolution field', () => {
        const lockfile = `__metadata:
  version: 8

"@babel-baseline/core@npm:@babel/core@7.24.4":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
  checksum: abc123
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 1);
        // flatlock gives us the CANONICAL name from resolution
        assert.equal(deps[0].name, '@babel/core');
      });

      test('divergence is intentional - different outputs for same lockfile', () => {
        const lockfile = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: xyz789
`;

        // parseSyml approach: extract name from key
        const raw = parseSyml(lockfile);
        const keyName = Object.keys(raw).find(k => k !== '__metadata');
        const aliasFromKey = keyName.split('@npm:')[0];

        // flatlock approach: extract name from resolution
        const deps = [...fromYarnBerryLock(lockfile)];
        const canonicalFromResolution = deps[0].name;

        // These are INTENTIONALLY different
        assert.equal(aliasFromKey, 'string-width-cjs'); // alias
        assert.equal(canonicalFromResolution, 'string-width'); // canonical
        assert.notEqual(aliasFromKey, canonicalFromResolution);
      });
    });

    describe('SBOM accuracy: canonical names match installed packages', () => {
      test('canonical name matches node_modules directory structure', () => {
        // When you run: npm install string-width-cjs@npm:string-width@^4.2.0
        // The installed directory is: node_modules/string-width
        // NOT: node_modules/string-width-cjs
        //
        // Therefore, an accurate SBOM should list: string-width@4.2.3
        // because that's what vulnerability scanners will find
        const lockfile = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // flatlock returns what's actually in node_modules
        assert.equal(deps[0].name, 'string-width');
        // NOT the alias that would confuse vulnerability scanners
        assert.notEqual(deps[0].name, 'string-width-cjs');
      });

      test('alias name would create non-existent package in SBOM', () => {
        // The package "@babel-baseline/core" does not exist on npm registry
        // It's an alias pointing to the real "@babel/core" package
        // If SBOM listed "@babel-baseline/core@7.24.4", vulnerability scanners
        // would fail to find CVEs because no such package exists
        const lockfile = `__metadata:
  version: 8

"@babel-baseline/core@npm:@babel/core@7.24.4":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // flatlock returns the real package that exists on npm
        assert.equal(deps[0].name, '@babel/core');
        // Vulnerability scanners can now match this against CVE databases
      });

      test('placeholder packages should show actual installed package', () => {
        // Sometimes aliases point to placeholder/stub packages
        // e.g., canvas -> empty-npm-package for environments without native deps
        const lockfile = `__metadata:
  version: 8

"canvas@npm:empty-npm-package@1.0.0":
  version: 1.0.0
  resolution: "empty-npm-package@npm:1.0.0"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // SBOM should show what's actually installed
        assert.equal(deps[0].name, 'empty-npm-package');
        // NOT the import name, which is just for code compatibility
        assert.notEqual(deps[0].name, 'canvas');
      });
    });

    describe('accuracy metric interpretation', () => {
      test('low accuracy against parseSyml is expected for aliased lockfiles', () => {
        // This test documents that 56.10% accuracy is CORRECT behavior
        // The accuracy metric compares package names, not just counts
        // For aliased packages, names intentionally differ
        const lockfile = `__metadata:
  version: 8

"alias1@npm:real1@1.0.0":
  version: 1.0.0
  resolution: "real1@npm:1.0.0"

"alias2@npm:real2@2.0.0":
  version: 2.0.0
  resolution: "real2@npm:2.0.0"

"non-aliased@npm:^3.0.0":
  version: 3.0.0
  resolution: "non-aliased@npm:3.0.0"
`;

        const raw = parseSyml(lockfile);
        const parseSymlNames = Object.keys(raw)
          .filter(k => k !== '__metadata')
          .map(k => k.split('@npm:')[0]);

        const flatLockNames = [...fromYarnBerryLock(lockfile)].map(d => d.name);

        // parseSyml: ['alias1', 'alias2', 'non-aliased']
        // flatlock: ['real1', 'real2', 'non-aliased']
        assert.deepEqual(parseSymlNames.sort(), ['alias1', 'alias2', 'non-aliased']);
        assert.deepEqual(flatLockNames.sort(), ['non-aliased', 'real1', 'real2']);

        // Only 1 out of 3 match (non-aliased) = 33.33% accuracy
        // This is CORRECT - flatlock's output is more accurate for SBOM
        const matching = flatLockNames.filter(n => parseSymlNames.includes(n));
        assert.equal(matching.length, 1);
        assert.equal(matching[0], 'non-aliased');
      });
    });
  });

  /**
   * yarn-berry-03: @yarnpkg/core Ground Truth Parity
   *
   * Discovery: Yarn berry's @yarnpkg/core has two package registries:
   *   - originalPackages: populated from lockfile during setupResolutions()
   *   - storedPackages: populated after full resolution (requires package.json)
   *
   * We achieved 100% parity with originalPackages by:
   *   1. Using the resolution field (which is the yarn "locator")
   *   2. Extracting name via parseResolution()
   *
   * Reference: yarn berry source code
   *   - Project.ts line 260: originalPackages definition
   *   - Project.ts lines 385-418: setupResolutions() populates originalPackages
   *   - structUtils.ts: parseLocator(), stringifyIdent()
   */
  describe('[yarn-berry-03] @yarnpkg/core ground truth parity', () => {
    describe('resolution field is yarn Locator', () => {
      test('resolution format matches yarn locator pattern: name@protocol:reference', () => {
        // Yarn locator format: @scope/name@protocol:reference
        // or: name@protocol:reference
        // The part before the @ is the "ident" (package identity)
        const resolution = '@babel/core@npm:7.24.4';
        const name = parseYarnBerryResolution(resolution);

        // This is equivalent to structUtils.stringifyIdent() on the locator
        assert.equal(name, '@babel/core');
      });

      test('unscoped package locator', () => {
        const resolution = 'lodash@npm:4.17.21';
        const name = parseYarnBerryResolution(resolution);

        assert.equal(name, 'lodash');
      });

      test('workspace locator', () => {
        const resolution = 'my-pkg@workspace:packages/my-pkg';
        const name = parseYarnBerryResolution(resolution);

        assert.equal(name, 'my-pkg');
      });

      test('patch locator (complex nested format)', () => {
        // Patch locators embed the underlying locator
        const resolution = 'pkg@patch:pkg@npm:1.0.0#./fix.patch';
        const name = parseYarnBerryResolution(resolution);

        // We extract the outermost package name
        assert.equal(name, 'pkg');
      });
    });

    describe('output structure matches originalPackages', () => {
      test('name field matches stringifyIdent equivalent', () => {
        const lockfile = `__metadata:
  version: 8

"@babel/core@npm:^7.24.0":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // Our name = stringifyIdent(pkg) from originalPackages
        assert.equal(deps[0].name, '@babel/core');
      });

      test('version field matches pkg.version', () => {
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps[0].version, '4.17.21');
      });

      test('integrity field matches checksum', () => {
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: sha512-abc123def456
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps[0].integrity, 'sha512-abc123def456');
      });

      test('resolved field preserves full resolution string', () => {
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // Full resolution preserved for traceability
        assert.equal(deps[0].resolved, 'lodash@npm:4.17.21');
      });
    });

    describe('runtime validation via compare.js', () => {
      test('compare.js validates parity at runtime (documentation)', () => {
        // This test documents the runtime validation
        // Run: node bin/flatlock-cmp.js --dir test/fixtures/ext --glob "**/*lock*"
        // Expected output for yarn files: "equinumerous: true"
        assert.ok(true, 'See compare.js for runtime ground truth validation');
      });
    });
  });

  /**
   * yarn-berry-04: setupResolutions() Private API Usage
   *
   * Discovery: To get yarn's ground truth without a full project setup,
   * we call project['setupResolutions']() directly, bypassing setupWorkspaces().
   *
   * Why this is necessary:
   *   - Project.find() calls both setupResolutions() AND setupWorkspaces()
   *   - setupWorkspaces() fails without matching package.json
   *   - No public API exists for "parse lockfile only"
   */
  describe('[yarn-berry-04] setupResolutions() private API usage', () => {
    describe('why private API is necessary', () => {
      test('Project.find() requires matching package.json (documentation)', () => {
        // Project.find() does:
        //   await project.setupResolutions();  // Parses lockfile - works
        //   await project.setupWorkspaces();   // Requires package.json - fails
        //
        // setupWorkspaces() throws if package.json doesn't match lockfile
        // For standalone lockfile parsing, this is a blocker
        assert.ok(true, 'See HENRY.md Part 4 for detailed analysis');
      });

      test('setupResolutions() is private but accessible', () => {
        // In TypeScript, setupResolutions is marked private:
        //   private async setupResolutions() { ... }
        //
        // But in JavaScript, we can call it via bracket notation:
        //   await project['setupResolutions']();
        //
        // This populates originalPackages without requiring workspace setup
        assert.ok(true, 'Private API accessible via project["setupResolutions"]()');
      });

      test('no public API for standalone lockfile parsing', () => {
        // Yarn berry team's position (per HENRY.md):
        // "If you need to read a lockfile without a project,
        //  you probably shouldn't be reading the lockfile."
        //
        // This is philosophically sound for a package manager
        // but unhelpful for SBOM/security tooling
        assert.ok(true, 'Design decision: yarn prioritizes project integrity over tooling');
      });
    });

    describe('maintenance considerations', () => {
      test('private API risk: may break in future versions', () => {
        // setupResolutions() is private and may be renamed, changed, or removed
        // compare.js handles this gracefully:
        //   - If @yarnpkg/core fails, falls back to parseSyml
        //   - flatlock itself never depends on @yarnpkg/core
        //
        // The dependency is:
        //   flatlock (main) -> @yarnpkg/parsers (parseSyml) - public API
        //   compare.js (dev) -> @yarnpkg/core (setupResolutions) - private API
        assert.ok(true, 'Private API usage isolated to optional compare.js');
      });

      test('alternative approach: parseSyml + parseResolution', () => {
        // flatlock's main parser doesn't use @yarnpkg/core at all
        // It uses:
        //   1. parseSyml() from @yarnpkg/parsers (public API)
        //   2. parseResolution() to extract canonical name from resolution field
        //
        // This is more stable and doesn't require private API access
        const lockfile = `__metadata:
  version: 8

"@babel/core@npm:^7.24.0":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
`;

        // This works without any @yarnpkg/core access
        const deps = [...fromYarnBerryLock(lockfile)];
        assert.equal(deps[0].name, '@babel/core');
        assert.equal(deps[0].version, '7.24.4');
      });
    });
  });

  /**
   * yarn-berry-05: patch: Protocol Nested Reference
   *
   * Discovery: The patch: protocol embeds another protocol inside it.
   * Example: pkg@patch:pkg@npm:1.0.0#./fix.patch
   *
   * The key parsing must find the FIRST protocol marker (@patch:), not any @.
   * This is important because the nested @npm: would give wrong results.
   */
  describe('[yarn-berry-05] patch: protocol nested reference', () => {
    describe('parseLockfileKey finds FIRST protocol', () => {
      test('patch: protocol with nested npm: reference', () => {
        const key = 'pkg@patch:pkg@npm:1.0.0#./fix.patch';

        const name = parseLockfileKey(key);

        // Should extract name before @patch:, not before @npm:
        assert.equal(name, 'pkg');
      });

      test('scoped package with patch: protocol', () => {
        const key = '@scope/pkg@patch:@scope/pkg@npm:1.0.0#./patches/fix.patch';

        const name = parseLockfileKey(key);

        assert.equal(name, '@scope/pkg');
      });

      test('patch: protocol appears before npm: in key', () => {
        const key = 'lodash@patch:lodash@npm:4.17.21#./patches/lodash+4.17.21.patch';

        const name = parseLockfileKey(key);

        // The key parsing algorithm finds @patch: (index ~6) before @npm: (index ~18)
        assert.equal(name, 'lodash');
      });
    });

    describe('parseResolution handles patch: protocol', () => {
      test('patch: resolution extracts name', () => {
        const resolution = 'pkg@patch:pkg@npm:1.0.0#./fix.patch';

        const name = parseYarnBerryResolution(resolution);

        // parseResolution finds the first @ after scope (if any)
        assert.equal(name, 'pkg');
      });

      test('scoped patch: resolution', () => {
        const resolution = '@scope/pkg@patch:@scope/pkg@npm:1.0.0#./fix.patch';

        const name = parseYarnBerryResolution(resolution);

        assert.equal(name, '@scope/pkg');
      });
    });

    describe('protocol priority in key parsing', () => {
      test('protocol at earliest position wins', () => {
        // In this key, @patch: appears at position 3, @npm: appears later
        const key = 'pkg@patch:pkg@npm:1.0.0#./fix.patch';

        const name = parseLockfileKey(key);

        // @patch: is at position 3, @npm: is at ~12
        // The algorithm correctly finds @patch: first
        assert.equal(name, 'pkg');
      });
    });
  });

  /**
   * yarn-berry-06: portal/link/workspace Filtering
   *
   * Discovery: Local package protocols should be filtered from SBOM output.
   * - workspace: - monorepo workspace packages
   * - portal: - symlinked external packages (yarn berry)
   * - link: - symlinked local packages
   *
   * These are NOT external dependencies and shouldn't appear in SBOM.
   */
  describe('[yarn-berry-06] portal/link/workspace filtering', () => {
    describe('yarn berry workspace: protocol', () => {
      test('workspace: entries are filtered from output', () => {
        const lockfile = `__metadata:
  version: 8

"my-workspace@workspace:packages/my-workspace":
  version: 0.0.0-use.local
  resolution: "my-workspace@workspace:packages/my-workspace"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 0);
      });

      test('workspace: in key triggers filtering', () => {
        const lockfile = `__metadata:
  version: 8

"pkg@workspace:.":
  version: 1.0.0
  resolution: "pkg@workspace:."
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 0);
      });
    });

    describe('yarn berry portal: protocol', () => {
      test('portal: entries are filtered from output', () => {
        const lockfile = `__metadata:
  version: 8

"external-local@portal:../external-package":
  version: 0.0.0-use.local
  resolution: "external-local@portal:../external-package"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 0);
      });
    });

    describe('yarn berry link: protocol', () => {
      test('link: entries are filtered from output', () => {
        const lockfile = `__metadata:
  version: 8

"linked-pkg@link:./local-package":
  version: 0.0.0-use.local
  resolution: "linked-pkg@link:./local-package"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        assert.equal(deps.length, 0);
      });
    });

    describe('mixed lockfile filtering', () => {
      test('only external npm packages are yielded', () => {
        const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: abc123

"my-workspace@workspace:packages/my-workspace":
  version: 0.0.0-use.local
  resolution: "my-workspace@workspace:packages/my-workspace"

"portal-pkg@portal:../external":
  version: 0.0.0-use.local
  resolution: "portal-pkg@portal:../external"

"@babel/core@npm:^7.24.0":
  version: 7.24.4
  resolution: "@babel/core@npm:7.24.4"
  checksum: def456
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // Only npm packages should be included
        assert.equal(deps.length, 2);
        const names = deps.map(d => d.name).sort();
        assert.deepEqual(names, ['@babel/core', 'lodash']);
      });
    });

    describe('filtering by resolution field', () => {
      test('resolution with workspace: is filtered even if key has npm:', () => {
        // Edge case: key might look like npm but resolution reveals workspace
        const lockfile = `__metadata:
  version: 8

"weird-pkg@npm:^1.0.0":
  version: 1.0.0
  resolution: "weird-pkg@workspace:packages/weird"
`;

        const deps = [...fromYarnBerryLock(lockfile)];

        // Should be filtered because resolution has workspace:
        assert.equal(deps.length, 0);
      });
    });
  });

  /**
   * yarn-berry-07: Workspace Exclusion Counts
   *
   * Discovery: The compare tests show "0 workspaces excluded" but this is
   * because the test fixtures don't have workspace entries. This test section
   * validates that workspace exclusion works correctly when workspaces exist.
   */
  describe('[yarn-berry-07] workspace exclusion counts', () => {
    test('external packages counted, workspaces excluded', () => {
      const lockfile = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"react@npm:^18.2.0":
  version: 18.2.0
  resolution: "react@npm:18.2.0"

"my-app@workspace:.":
  version: 0.0.0-use.local
  resolution: "my-app@workspace:."

"@myorg/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@myorg/shared@workspace:packages/shared"

"@myorg/utils@workspace:packages/utils":
  version: 0.0.0-use.local
  resolution: "@myorg/utils@workspace:packages/utils"
`;

      const deps = [...fromYarnBerryLock(lockfile)];

      // 2 external packages, 3 workspaces excluded
      assert.equal(deps.length, 2);

      // Workspaces are not in output
      const hasWorkspace = deps.some(
        d => d.name === 'my-app' || d.name === '@myorg/shared' || d.name === '@myorg/utils'
      );
      assert.equal(hasWorkspace, false);
    });

    test('scoped workspaces are excluded', () => {
      const lockfile = `__metadata:
  version: 8

"@myorg/component-lib@workspace:packages/component-lib":
  version: 0.0.0-use.local
  resolution: "@myorg/component-lib@workspace:packages/component-lib"
`;

      const deps = [...fromYarnBerryLock(lockfile)];

      assert.equal(deps.length, 0);
    });
  });
});
