/**
 * FlatlockSet comprehensive tests
 */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import { FlatlockSet, Type } from '../src/index.js';
import { loadFixture } from './support.js';

describe('FlatlockSet', () => {
  describe('Construction', () => {
    describe('fromPath', () => {
      test('loads npm lockfile v2', async () => {
        // Use the real fixture path (base64 encoded file)
        const content = loadFixture('npm/package-lock.json.v2');
        const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.NPM);
        assert.strictEqual(set.canTraverse, true);
      });

      test('loads npm lockfile v3', async () => {
        const content = loadFixture('npm/package-lock.json.v3');
        const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.NPM);
      });

      test('loads pnpm lockfile v6', async () => {
        const content = loadFixture('pnpm/pnpm-lock.yaml.v6');
        const set = FlatlockSet.fromString(content, { path: 'pnpm-lock.yaml' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.PNPM);
      });

      test('loads pnpm lockfile v9', async () => {
        const content = loadFixture('pnpm/pnpm-lock.yaml.v9');
        const set = FlatlockSet.fromString(content, { path: 'pnpm-lock.yaml' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.PNPM);
      });

      test('loads yarn classic lockfile', async () => {
        const content = loadFixture('yarn/yarn.lock');
        const set = FlatlockSet.fromString(content, { path: 'yarn.lock' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.YARN_CLASSIC);
      });

      test('loads yarn berry v5 lockfile', async () => {
        const content = loadFixture('yarn-berry/yarn.lock.v5');
        const set = FlatlockSet.fromString(content, { path: 'yarn.lock' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.YARN_BERRY);
      });

      test('loads yarn berry v8 lockfile', async () => {
        const content = loadFixture('yarn-berry/yarn.lock.v8');
        const set = FlatlockSet.fromString(content, { path: 'yarn.lock' });

        assert.ok(set.size > 0, 'should have dependencies');
        assert.strictEqual(set.type, Type.YARN_BERRY);
      });
    });

    describe('fromString', () => {
      test('parses lockfile content with explicit type', () => {
        const content = loadFixture('npm/package-lock.json.v2');
        const set = FlatlockSet.fromString(content, { type: Type.NPM });

        assert.ok(set.size > 0);
        assert.strictEqual(set.type, Type.NPM);
      });

      test('handles arbitrary text as yarn-classic (parser is permissive)', () => {
        // The yarn classic parser is very permissive and accepts almost any text
        // This is not an error - it creates a set (possibly empty or with odd entries)
        const set = FlatlockSet.fromString('invalid content', { path: 'yarn.lock' });
        assert.strictEqual(set.type, Type.YARN_CLASSIC);
      });

      test('throws on empty content', () => {
        assert.throws(() => FlatlockSet.fromString(''), {
          message: /Unable to detect lockfile type/
        });
      });
    });

    describe('direct construction', () => {
      test('throws when constructed directly', () => {
        assert.throws(() => new FlatlockSet(Symbol('fake'), new Map(), null, null, null), {
          message: /FlatlockSet cannot be constructed directly/
        });
      });
    });
  });

  describe('Properties', () => {
    test('size returns dependency count', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.strictEqual(typeof set.size, 'number');
      assert.ok(set.size > 0);
    });

    test('type returns lockfile type', () => {
      const content = loadFixture('pnpm/pnpm-lock.yaml.v6');
      const set = FlatlockSet.fromString(content, { path: 'pnpm-lock.yaml' });

      assert.strictEqual(set.type, Type.PNPM);
    });

    test('canTraverse is true for source sets', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.strictEqual(set.canTraverse, true);
    });
  });

  describe('Set methods', () => {
    let set;

    test('has() checks for dependency existence', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      // Get first dependency to test has()
      const firstKey = set.keys().next().value;
      assert.ok(firstKey, 'should have at least one dependency');

      assert.strictEqual(set.has(firstKey), true);
      assert.strictEqual(set.has('nonexistent@0.0.0'), false);
    });

    test('get() retrieves dependency', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const firstKey = set.keys().next().value;
      const dep = set.get(firstKey);

      assert.ok(dep, 'should return dependency');
      assert.ok(dep.name, 'dependency should have name');
      assert.ok(dep.version, 'dependency should have version');
    });

    test('get() returns undefined for nonexistent', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.strictEqual(set.get('nonexistent@0.0.0'), undefined);
    });

    test('keys() returns iterator of keys', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const keys = [...set.keys()];
      assert.ok(keys.length > 0);
      assert.ok(keys.every(k => typeof k === 'string'));
      assert.ok(keys.every(k => k.includes('@')));
    });

    test('values() returns iterator of dependencies', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const values = [...set.values()];
      assert.ok(values.length > 0);
      assert.ok(values.every(v => v.name && v.version));
    });

    test('entries() returns iterator of [key, dependency] pairs', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const entries = [...set.entries()];
      assert.ok(entries.length > 0);

      const [key, dep] = entries[0];
      assert.strictEqual(key, `${dep.name}@${dep.version}`);
    });

    test('forEach() iterates over all dependencies', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const collected = [];
      set.forEach((dep, key) => {
        collected.push({ key, dep });
      });

      assert.strictEqual(collected.length, set.size);
    });

    test('forEach() respects thisArg', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const context = { count: 0 };
      set.forEach(function () {
        this.count++;
      }, context);

      assert.strictEqual(context.count, set.size);
    });

    test('Symbol.iterator returns values', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const deps = [...set];
      assert.strictEqual(deps.length, set.size);
      assert.ok(deps.every(d => d.name && d.version));
    });

    test('toArray() converts to array', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const arr = set.toArray();
      assert.ok(Array.isArray(arr));
      assert.strictEqual(arr.length, set.size);
    });
  });

  describe('Set operations', () => {
    let set1, set2;

    // Use small fixtures for set operations
    test('union() combines two sets', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const union = set1.union(set2);

      // Union should have at least as many as the larger set
      assert.ok(union.size >= Math.max(set1.size, set2.size));

      // All elements from both sets should be in union
      for (const key of set1.keys()) {
        assert.ok(union.has(key), `union should contain ${key} from set1`);
      }
      for (const key of set2.keys()) {
        assert.ok(union.has(key), `union should contain ${key} from set2`);
      }
    });

    test('union() result has canTraverse=false', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const union = set1.union(set2);
      assert.strictEqual(union.canTraverse, false);
    });

    test('intersection() finds common dependencies', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const intersection = set1.intersection(set2);

      // Intersection should be smaller than or equal to both sets
      assert.ok(intersection.size <= set1.size);
      assert.ok(intersection.size <= set2.size);

      // All elements in intersection should be in both sets
      for (const key of intersection.keys()) {
        assert.ok(set1.has(key) && set2.has(key));
      }
    });

    test('intersection() result has canTraverse=false', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const intersection = set1.intersection(set2);
      assert.strictEqual(intersection.canTraverse, false);
    });

    test('difference() finds elements only in first set', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const diff = set1.difference(set2);

      // Difference should not be larger than set1
      assert.ok(diff.size <= set1.size);

      // All elements in diff should be in set1 but not set2
      for (const key of diff.keys()) {
        assert.ok(set1.has(key), `${key} should be in set1`);
        assert.ok(!set2.has(key), `${key} should not be in set2`);
      }
    });

    test('difference() result has canTraverse=false', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const diff = set1.difference(set2);
      assert.strictEqual(diff.canTraverse, false);
    });
  });

  describe('Predicates', () => {
    test('isSubsetOf() returns true for subset', () => {
      const content = loadFixture('npm/package-lock.json.v3');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      // A set is always a subset of itself
      assert.strictEqual(set.isSubsetOf(set), true);
    });

    test('isSubsetOf() returns true for derived subset', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      const set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      const set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const intersection = set1.intersection(set2);

      // Intersection is subset of both original sets
      assert.strictEqual(intersection.isSubsetOf(set1), true);
      assert.strictEqual(intersection.isSubsetOf(set2), true);
    });

    test('isSupersetOf() returns true for superset', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      const set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      const set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const union = set1.union(set2);

      // Union is superset of both original sets
      assert.strictEqual(union.isSupersetOf(set1), true);
      assert.strictEqual(union.isSupersetOf(set2), true);
    });

    test('isDisjointFrom() returns true for no common elements', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      const set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      const set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      // Create disjoint sets from difference
      const onlyInSet1 = set1.difference(set2);
      const onlyInSet2 = set2.difference(set1);

      assert.strictEqual(onlyInSet1.isDisjointFrom(onlyInSet2), true);
    });

    test('isDisjointFrom() returns false for overlapping sets', () => {
      const content = loadFixture('npm/package-lock.json.v3');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      // A set is never disjoint from itself (unless empty)
      if (set.size > 0) {
        assert.strictEqual(set.isDisjointFrom(set), false);
      }
    });
  });

  describe('dependenciesOf', () => {
    test('throws on null packageJson', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.throws(() => set.dependenciesOf(null), {
        name: 'TypeError',
        message: 'packageJson must be a non-null object'
      });
    });

    test('throws on undefined packageJson', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.throws(() => set.dependenciesOf(undefined), {
        name: 'TypeError',
        message: 'packageJson must be a non-null object'
      });
    });

    test('throws on primitive packageJson', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      assert.throws(() => set.dependenciesOf('string'), {
        name: 'TypeError',
        message: 'packageJson must be a non-null object'
      });
    });

    test('throws on sets from set operations', () => {
      const content1 = loadFixture('npm/package-lock.json.v3');
      const content2 = loadFixture('pnpm/pnpm-lock.yaml.v9');

      const set1 = FlatlockSet.fromString(content1, { path: 'package-lock.json' });
      const set2 = FlatlockSet.fromString(content2, { path: 'pnpm-lock.yaml' });

      const union = set1.union(set2);

      assert.throws(() => union.dependenciesOf({ dependencies: {} }), {
        message: /dependenciesOf\(\) requires lockfile data/
      });
    });

    test('returns subset for basic dependencies', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      // Get first dependency name to create a minimal packageJson
      const firstDep = set.values().next().value;
      const packageJson = {
        dependencies: {
          [firstDep.name]: firstDep.version
        }
      };

      const subset = set.dependenciesOf(packageJson);

      assert.ok(subset.size >= 1, 'should have at least the direct dependency');
      assert.strictEqual(subset.canTraverse, false, 'result should not be traversable');
    });

    test('respects dev option', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const deps = [...set.values()];
      const [dep1, dep2] = deps.slice(0, 2);

      if (dep1 && dep2) {
        const packageJson = {
          dependencies: { [dep1.name]: dep1.version },
          devDependencies: { [dep2.name]: dep2.version }
        };

        // Without dev
        const withoutDev = set.dependenciesOf(packageJson, { dev: false });

        // With dev
        const withDev = set.dependenciesOf(packageJson, { dev: true });

        // With dev should have at least as many deps (may have same deps if transitive)
        assert.ok(withDev.size >= withoutDev.size);
      }
    });

    test('respects optional option', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const deps = [...set.values()];
      const [dep1, dep2] = deps.slice(0, 2);

      if (dep1 && dep2) {
        const packageJson = {
          dependencies: { [dep1.name]: dep1.version },
          optionalDependencies: { [dep2.name]: dep2.version }
        };

        // optional defaults to true
        const withOptional = set.dependenciesOf(packageJson);

        // Explicitly without optional
        const withoutOptional = set.dependenciesOf(packageJson, { optional: false });

        assert.ok(withOptional.size >= withoutOptional.size);
      }
    });

    test('respects peer option', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const deps = [...set.values()];
      const [dep1, dep2] = deps.slice(0, 2);

      if (dep1 && dep2) {
        const packageJson = {
          dependencies: { [dep1.name]: dep1.version },
          peerDependencies: { [dep2.name]: dep2.version }
        };

        // peer defaults to false
        const withoutPeer = set.dependenciesOf(packageJson);

        // With peer
        const withPeer = set.dependenciesOf(packageJson, { peer: true });

        assert.ok(withPeer.size >= withoutPeer.size);
      }
    });

    test('handles empty dependencies', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      const packageJson = {
        dependencies: {}
      };

      const subset = set.dependenciesOf(packageJson);
      assert.strictEqual(subset.size, 0);
    });
  });

  describe('Edge cases', () => {
    test('handles scoped packages', () => {
      const content = loadFixture('npm/package-lock.json.v2');
      const set = FlatlockSet.fromString(content, { path: 'package-lock.json' });

      // Find a scoped package
      const scopedDep = [...set.values()].find(d => d.name.startsWith('@'));

      if (scopedDep) {
        const key = `${scopedDep.name}@${scopedDep.version}`;
        assert.ok(set.has(key), 'should find scoped package by key');
        assert.strictEqual(set.get(key), scopedDep);
      }
    });

    test('works with pnpm lockfiles', () => {
      const content = loadFixture('pnpm/pnpm-lock.yaml.v6');
      const set = FlatlockSet.fromString(content, { path: 'pnpm-lock.yaml' });

      assert.ok(set.size > 0);

      // Test basic operations
      const firstKey = set.keys().next().value;
      assert.ok(set.has(firstKey));
      assert.ok(set.get(firstKey));
    });

    test('works with yarn classic lockfiles', () => {
      const content = loadFixture('yarn/yarn.lock');
      const set = FlatlockSet.fromString(content, { path: 'yarn.lock' });

      assert.ok(set.size > 0);
      assert.strictEqual(set.type, Type.YARN_CLASSIC);

      // Test basic operations
      const firstKey = set.keys().next().value;
      assert.ok(set.has(firstKey));
    });

    test('works with yarn berry lockfiles', () => {
      const content = loadFixture('yarn-berry/yarn.lock.v8');
      const set = FlatlockSet.fromString(content, { path: 'yarn.lock' });

      assert.ok(set.size > 0);
      assert.strictEqual(set.type, Type.YARN_BERRY);

      // Test basic operations
      const firstKey = set.keys().next().value;
      assert.ok(set.has(firstKey));
    });
  });
});
