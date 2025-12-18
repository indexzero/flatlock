import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as flatlock from '../src/index.js';
import { loadFixture } from './support.js';

describe('flatlock', () => {
  describe('.detectType({ path, content? })', () => {
    test('detects npm package-lock.json', () => {
      const type = flatlock.detectType({ path: 'package-lock.json' });
      assert.equal(type, flatlock.Type.NPM);
    });

    test('detects pnpm-lock.yaml', () => {
      const type = flatlock.detectType({ path: 'pnpm-lock.yaml' });
      assert.equal(type, flatlock.Type.PNPM);
    });

    test('detects yarn classic from filename without content', () => {
      const type = flatlock.detectType({ path: 'yarn.lock' });
      assert.equal(type, flatlock.Type.YARN_CLASSIC);
    });

    test('detects yarn berry from content', () => {
      const content = '__metadata:\n  version: 6';
      const type = flatlock.detectType({ path: 'yarn.lock', content });
      assert.equal(type, flatlock.Type.YARN_BERRY);
    });

    test('detects yarn classic from content', () => {
      const content = '# yarn lockfile v1\n\nlodash@^4.17.21:\n  version "4.17.21"';
      const type = flatlock.detectType({ path: 'yarn.lock', content });
      assert.equal(type, flatlock.Type.YARN_CLASSIC);
    });

    test('detects npm from JSON content', () => {
      const content = '{"lockfileVersion": 2}';
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.NPM);
    });

    test('detects pnpm from content only (no path)', () => {
      const content = 'lockfileVersion: 6.0\npackages:\n  /lodash@4.17.21:';
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.PNPM);
    });

    test('detects yarn berry from content only (no path)', () => {
      const content = '__metadata:\n  version: 8\n\n"lodash@npm:^4.17.21":';
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.YARN_BERRY);
    });

    test('detects yarn classic from content only (no path)', () => {
      const content = '# yarn lockfile v1\n\nlodash@^4.17.21:\n  version "4.17.21"';
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.YARN_CLASSIC);
    });

    test('content takes precedence over path', () => {
      // Pass npm path but pnpm content - content should win
      const content = 'lockfileVersion: 9.0\npackages:';
      const type = flatlock.detectType({ path: 'package-lock.json', content });
      assert.equal(type, flatlock.Type.PNPM);
    });
  });

  describe('Security: spoofing attack resistance', () => {
    test('npm lockfile with __metadata string is still detected as npm', () => {
      // Attack: try to make npm look like yarn berry by including __metadata in a string
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/malicious': {
            version: '1.0.0',
            resolved: 'https://evil.com/__metadata:/evil.tgz',
            integrity: 'sha512-fake'
          }
        }
      });
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.NPM);
    });

    test('npm lockfile with lockfileVersion in string is still detected as npm', () => {
      // Attack: lockfileVersion appears in a URL, not as root property
      const content = JSON.stringify({
        lockfileVersion: 2,
        packages: {
          'node_modules/test': {
            version: '1.0.0',
            resolved: 'https://example.com/lockfileVersion:6.0/pkg.tgz'
          }
        }
      });
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.NPM);
    });

    test('content with fake markers but invalid structure is rejected', () => {
      // Attack: include detection markers but invalid structure
      const content = `
        This file contains __metadata: and lockfileVersion: markers
        but is not a valid lockfile of any type
        # yarn lockfile v1
      `;
      assert.throws(() => {
        flatlock.detectType({ content });
      }, /Unable to detect lockfile type/);
    });

    test('JSON with yarn-like __metadata but lockfileVersion number is npm', () => {
      // Attack: try to confuse detection with __metadata in a valid npm lockfile
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'node_modules/__metadata': {
            version: '1.0.0'
          }
        }
      });
      const type = flatlock.detectType({ content });
      // Should be npm because JSON.parse succeeds and lockfileVersion is a number at root
      assert.equal(type, flatlock.Type.NPM);
    });

    test('YAML with npm-like lockfileVersion number is pnpm not npm', () => {
      // Even if YAML has a number lockfileVersion, it's not valid JSON so not npm
      const content = `lockfileVersion: 6
packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-test}
`;
      const type = flatlock.detectType({ content });
      assert.equal(type, flatlock.Type.PNPM);
    });

    test('malformed JSON with lockfileVersion string is not detected as npm', () => {
      // lockfileVersion must be a NUMBER for npm
      const content = JSON.stringify({
        lockfileVersion: '3', // string, not number
        packages: {}
      });
      // This should NOT be detected as npm since lockfileVersion is a string
      const type = flatlock.detectType({ content });
      // Will fall through to pnpm detection (YAML can parse JSON)
      assert.notEqual(type, flatlock.Type.NPM);
    });
  });

  describe('fromString(content, { path? })', () => {
    describe('npm parser', () => {
      test('parses package-lock.json v2', () => {
        const content = loadFixture('npm/package-lock.json.v2');
        const deps = [...flatlock.fromString(content, { path: 'package-lock.json' })];

        assert.ok(deps.length > 0, 'Should have dependencies');

        // Check structure
        const dep = deps[0];
        assert.ok(dep.name, 'Dependency should have name');
        assert.ok(dep.version, 'Dependency should have version');
      });

      test('parses package-lock.json v3', () => {
        const content = loadFixture('npm/package-lock.json.v3');
        const deps = [...flatlock.fromString(content, { path: 'package-lock.json' })];

        assert.ok(deps.length > 0, 'Should have dependencies');
      });

      test('fromPackageLock parses directly', () => {
        const content = JSON.stringify({
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': {
              name: 'lodash',
              version: '4.17.21',
              resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
              integrity: 'sha512-test123'
            }
          }
        });

        const deps = [...flatlock.fromPackageLock(content)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
        assert.equal(deps[0].integrity, 'sha512-test123');
      });
    });

    describe('pnpm parser', () => {
      test('parses pnpm-lock.yaml v6', () => {
        const content = loadFixture('pnpm/pnpm-lock.yaml.v6');
        const deps = [...flatlock.fromString(content, { path: 'pnpm-lock.yaml' })];

        assert.ok(deps.length > 0, 'Should have dependencies');

        const dep = deps[0];
        assert.ok(dep.name, 'Dependency should have name');
        assert.ok(dep.version, 'Dependency should have version');
      });

      test('parses pnpm-lock.yaml v9', () => {
        const content = loadFixture('pnpm/pnpm-lock.yaml.v9');
        const deps = [...flatlock.fromString(content, { path: 'pnpm-lock.yaml' })];

        assert.ok(deps.length > 0, 'Should have dependencies');
      });

      test('fromPnpmLock parses directly', () => {
        const content = `
  lockfileVersion: '6.0'
  packages:
    /lodash@4.17.21:
      resolution: { integrity: sha512-test, tarball: https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz }
  `;

        const deps = [...flatlock.fromPnpmLock(content)];
        assert.ok(deps.length > 0);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });
    });

    // Note: pnpm parseSpec edge cases have been moved to test/parsers/pnpm.test.js
    // for comprehensive coverage of all pnpm lockfile versions and formats.

    describe('yarn classic parser', () => {
      test('parses yarn.lock v1', () => {
        const content = loadFixture('yarn/yarn.lock');
        const deps = [...flatlock.fromString(content, { path: 'yarn.lock' })];

        assert.ok(deps.length > 0, 'Should have dependencies');

        const dep = deps[0];
        assert.ok(dep.name, 'Dependency should have name');
        assert.ok(dep.version, 'Dependency should have version');
      });

      test('fromYarnClassicLock parses directly', () => {
        const content = `
  # yarn lockfile v1

  lodash@^4.17.21:
    version "4.17.21"
    resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
    integrity sha512-test123
  `;

        const deps = [...flatlock.fromYarnClassicLock(content)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });
    });

    describe('yarn berry parser', () => {
      test('parses yarn.lock v5', () => {
        const content = loadFixture('yarn-berry/yarn.lock.v5');
        const deps = [...flatlock.fromString(content, { path: 'yarn.lock' })];

        assert.ok(deps.length > 0, 'Should have dependencies');

        const dep = deps[0];
        assert.ok(dep.name, 'Dependency should have name');
        assert.ok(dep.version, 'Dependency should have version');
      });

      test('fromYarnBerryLock parses directly', () => {
        const content = `
  __metadata:
    version: 6

  "lodash@npm:^4.17.21":
    version: 4.17.21
    resolution: "lodash@npm:4.17.21"
    checksum: sha512-test123
  `;

        const deps = [...flatlock.fromYarnBerryLock(content)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
        assert.equal(deps[0].version, '4.17.21');
      });

      test('fromYarnLock auto-detects berry', () => {
        const content = `
  __metadata:
    version: 6

  "lodash@npm:^4.17.21":
    version: 4.17.21
  `;

        const deps = [...flatlock.fromYarnLock(content)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });

      test('fromYarnLock auto-detects classic', () => {
        const content = `
  # yarn lockfile v1

  lodash@^4.17.21:
    version "4.17.21"
  `;

        const deps = [...flatlock.fromYarnLock(content)];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });
    });

    describe('fromString with explicit type', () => {
      test('uses explicit type when provided', () => {
        const content = JSON.stringify({
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { name: 'lodash', version: '4.17.21' }
          }
        });

        const deps = [...flatlock.fromString(content, { type: flatlock.Type.NPM })];
        assert.equal(deps.length, 1);
        assert.equal(deps[0].name, 'lodash');
      });
    });
  });

  describe('tryFromString(content, { path? })', () => {
    test('tryFromString returns Ok for valid content', () => {
      const content = JSON.stringify({
        lockfileVersion: 2,
        packages: {
          '': { name: 'root', version: '1.0.0' },
          'node_modules/lodash': { name: 'lodash', version: '4.17.21' }
        }
      });

      const result = flatlock.tryFromString(content, { path: 'package-lock.json' });
      assert.equal(result.ok, true);
      assert.ok(result.value);
    });

    test('tryFromString returns Err for invalid content', () => {
      const content = 'this is not a valid lockfile of any type';
      const result = flatlock.tryFromString(content, { path: 'package-lock.json' });
      // Detection fails because content doesn't parse as any valid lockfile
      assert.equal(result.ok, false);
      assert.ok(result.error instanceof Error);
    });

    test('tryFromPath returns Ok for valid file', async () => {
      const { loadFixture, fixturePath } = await import('./support.js');
      const { writeFileSync, mkdirSync } = await import('node:fs');

      // Decode fixture and write to tmp for file-based test
      const content = loadFixture('npm/package-lock.json.v2');
      const tmpDir = fixturePath('tmp');
      mkdirSync(tmpDir, { recursive: true });
      const tmpPath = fixturePath('tmp/package-lock.json');
      writeFileSync(tmpPath, content);

      const result = await flatlock.tryFromPath(tmpPath);
      assert.equal(result.ok, true);
      assert.ok(result.value);
    });
  });

  describe('.from{PackageLock,PnpmLock,Yarn*Lock}(parsedLockfile)', () => {
    test('fromPackageLock accepts pre-parsed object', () => {
      const lockfile = {
        lockfileVersion: 2,
        packages: {
          '': { name: 'root', version: '1.0.0' },
          'node_modules/lodash': {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha512-test123'
          }
        }
      };

      // Pass object directly, not JSON string
      const deps = [...flatlock.fromPackageLock(lockfile)];
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'lodash');
      assert.equal(deps[0].version, '4.17.21');
      assert.equal(deps[0].integrity, 'sha512-test123');
    });

    test('fromPnpmLock accepts pre-parsed object', () => {
      const lockfile = {
        lockfileVersion: '6.0',
        packages: {
          '/lodash@4.17.21': {
            resolution: {
              integrity: 'sha512-test',
              tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz'
            }
          }
        }
      };

      // Pass object directly, not YAML string
      const deps = [...flatlock.fromPnpmLock(lockfile)];
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'lodash');
      assert.equal(deps[0].version, '4.17.21');
    });

    test('fromYarnClassicLock accepts pre-parsed object', () => {
      const lockfile = {
        'lodash@^4.17.21': {
          version: '4.17.21',
          resolved: 'https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha512-test123'
        }
      };

      // Pass object directly (this is what @yarnpkg/lockfile returns as result.object)
      const deps = [...flatlock.fromYarnClassicLock(lockfile)];
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'lodash');
      assert.equal(deps[0].version, '4.17.21');
    });

    test('fromYarnBerryLock accepts pre-parsed object', () => {
      const lockfile = {
        __metadata: { version: 6 },
        'lodash@npm:^4.17.21': {
          version: '4.17.21',
          resolution: 'lodash@npm:4.17.21',
          checksum: 'sha512-test123'
        }
      };

      // Pass object directly (this is what parseSyml returns)
      const deps = [...flatlock.fromYarnBerryLock(lockfile)];
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'lodash');
      assert.equal(deps[0].version, '4.17.21');
    });

    test('string and object produce same results for npm', () => {
      const lockfile = {
        lockfileVersion: 2,
        packages: {
          '': { name: 'root', version: '1.0.0' },
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/@babel/core': { version: '7.23.0' }
        }
      };

      const fromString = [...flatlock.fromPackageLock(JSON.stringify(lockfile))];
      const fromObject = [...flatlock.fromPackageLock(lockfile)];

      assert.equal(fromString.length, fromObject.length);
      assert.deepEqual(
        fromString.map(d => `${d.name}@${d.version}`).sort(),
        fromObject.map(d => `${d.name}@${d.version}`).sort()
      );
    });
  });

  describe('collect()', () => {
    test('recognizes YAML content as content, not path', async () => {
      const yamlContent = `lockfileVersion: '6.0'
packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-test }
`;
      // Should not throw - YAML content should be detected as content, not path
      const deps = await flatlock.collect(yamlContent, { type: flatlock.Type.PNPM });
      assert.ok(deps.length > 0);
      assert.equal(deps[0].name, 'lodash');
    });

    test('recognizes JSON content as content, not path', async () => {
      // Use pretty-printed JSON which has newlines (more realistic for lockfiles)
      const jsonContent = JSON.stringify(
        {
          lockfileVersion: 2,
          packages: {
            '': { name: 'root', version: '1.0.0' },
            'node_modules/lodash': { version: '4.17.21' }
          }
        },
        null,
        2
      );

      // Verify it has newlines (which is the primary detection signal)
      assert.ok(jsonContent.includes('\n'), 'JSON should have newlines');

      const deps = await flatlock.collect(jsonContent, { type: flatlock.Type.NPM });
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'lodash');
    });

    test('short strings without newlines are treated as paths', async () => {
      // A typical path is short and has no newlines
      const shortPath = '/some/path/to/package-lock.json';

      // This should try to read from the path (and fail since it does not exist)
      await assert.rejects(() => flatlock.collect(shortPath), /ENOENT|no such file/i);
    });

    test('long content without newlines is treated as content', async () => {
      // Create a minimal but "long" JSON lockfile (over 1000 chars) on a single line
      const packages = {};
      for (let i = 0; i < 20; i++) {
        packages[`node_modules/package-with-long-name-${i}`] = { version: '1.0.0' };
      }
      const longContent = JSON.stringify({ lockfileVersion: 2, packages });

      assert.ok(longContent.length > 1000, 'Content should be over 1000 chars');
      assert.ok(!longContent.includes('\n'), 'Content should be single line');

      const deps = await flatlock.collect(longContent, { type: flatlock.Type.NPM });
      assert.ok(deps.length > 0);
    });
  });
});
