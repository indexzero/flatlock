import { readFile } from 'node:fs/promises';
import yarnLockfile from '@yarnpkg/lockfile';
import { parseSyml } from '@yarnpkg/parsers';
import yaml from 'js-yaml';
import { detectType, Type } from './detect.js';
import {
  fromPackageLock,
  fromPnpmLock,
  fromYarnBerryLock,
  fromYarnClassicLock,
  parseYarnBerryKey,
  parseYarnClassicKey
} from './parsers/index.js';

/**
 * @typedef {import('./parsers/npm.js').Dependency} Dependency
 * @typedef {import('./detect.js').LockfileType} LockfileType
 */

/**
 * @typedef {Object} DependenciesOfOptions
 * @property {string} [workspacePath] - Path to workspace (e.g., 'packages/foo')
 * @property {boolean} [dev=false] - Include devDependencies
 * @property {boolean} [optional=true] - Include optionalDependencies
 * @property {boolean} [peer=false] - Include peerDependencies (default false: peers are provided by consumer)
 */

/**
 * @typedef {Object} FromStringOptions
 * @property {string} [path] - Path hint for type detection
 * @property {LockfileType} [type] - Explicit lockfile type
 */

/**
 * @typedef {Object} PackageJson
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {Record<string, string>} [peerDependencies]
 */

/**
 * @typedef {Record<string, any>} LockfilePackages
 */

/**
 * @typedef {Record<string, any>} LockfileImporters
 */

/** Symbol to prevent direct construction */
const INTERNAL = Symbol('FlatlockSet.internal');

/**
 * A Set-like container for lockfile dependencies.
 *
 * Identity is determined by name@version. Two dependencies with the same
 * name and version are considered equal, regardless of integrity or resolved URL.
 *
 * All set operations return new FlatlockSet instances (immutable pattern).
 *
 * NOTE: Set operations (union, intersection, difference) return sets that
 * cannot use dependenciesOf() because they lack lockfile traversal data.
 *
 * @example
 * const set = await FlatlockSet.fromPath('./package-lock.json');
 * console.log(set.size); // 1234
 * console.log(set.has('lodash@4.17.21')); // true
 *
 * // Get dependencies for a specific workspace
 * const pkg = JSON.parse(await readFile('./packages/foo/package.json'));
 * const subset = set.dependenciesOf(pkg, { workspacePath: 'packages/foo' });
 *
 * // Set operations
 * const other = await FlatlockSet.fromPath('./other-lock.json');
 * const common = set.intersection(other);
 */
export class FlatlockSet {
  /** @type {Map<string, Dependency>} */
  #deps = new Map();

  /** @type {LockfilePackages | null} Raw lockfile packages for traversal */
  #packages = null;

  /** @type {LockfileImporters | null} Workspace importers (pnpm) */
  #importers = null;

  /** @type {LockfileType | null} */
  #type = null;

  /** @type {boolean} Whether this set supports dependenciesOf */
  #canTraverse = false;

  /**
   * @param {symbol} internal - Must be INTERNAL symbol
   * @param {Map<string, Dependency>} deps
   * @param {LockfilePackages | null} packages
   * @param {LockfileImporters | null} importers
   * @param {LockfileType | null} type
   */
  constructor(internal, deps, packages, importers, type) {
    if (internal !== INTERNAL) {
      throw new Error(
        'FlatlockSet cannot be constructed directly. Use FlatlockSet.fromPath() or FlatlockSet.fromString()'
      );
    }
    this.#deps = deps;
    this.#packages = packages;
    this.#importers = importers;
    this.#type = type;
    this.#canTraverse = packages !== null;
  }

  /**
   * Create FlatlockSet from lockfile path (auto-detect type)
   * @param {string} path - Path to lockfile
   * @param {FromStringOptions} [options] - Parser options
   * @returns {Promise<FlatlockSet>}
   */
  static async fromPath(path, options = {}) {
    const content = await readFile(path, 'utf8');
    return FlatlockSet.fromString(content, { ...options, path });
  }

  /**
   * Create FlatlockSet from lockfile string
   * @param {string} content - Lockfile content
   * @param {FromStringOptions} [options] - Parser options
   * @returns {FlatlockSet}
   */
  static fromString(content, options = {}) {
    const type = options.type || detectType({ path: options.path, content });

    if (!type) {
      throw new Error(
        'Unable to detect lockfile type. ' +
          'Provide options.type explicitly or ensure content is a valid lockfile format.'
      );
    }

    // Parse once, extract both deps and raw data
    const { deps, packages, importers } = FlatlockSet.#parseAll(content, type, options);

    return new FlatlockSet(INTERNAL, deps, packages, importers, type);
  }

  /**
   * Parse lockfile once, returning both processed deps and raw data
   * @param {string} content
   * @param {LockfileType} type
   * @param {FromStringOptions} options
   * @returns {{ deps: Map<string, Dependency>, packages: LockfilePackages, importers: LockfileImporters | null }}
   */
  static #parseAll(content, type, options) {
    /** @type {Map<string, Dependency>} */
    const deps = new Map();
    /** @type {LockfilePackages} */
    let packages = {};
    /** @type {LockfileImporters | null} */
    let importers = null;

    switch (type) {
      case Type.NPM: {
        const lockfile = JSON.parse(content);
        packages = lockfile.packages || {};
        for (const dep of fromPackageLock(content, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.PNPM: {
        /** @type {any} */
        const lockfile = yaml.load(content);
        packages = lockfile.packages || {};
        importers = lockfile.importers || null;
        for (const dep of fromPnpmLock(content, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.YARN_CLASSIC: {
        const parse = yarnLockfile.default?.parse || yarnLockfile.parse;
        const result = parse(content);
        packages = result.object || {};
        for (const dep of fromYarnClassicLock(content, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.YARN_BERRY: {
        packages = parseSyml(content);
        for (const dep of fromYarnBerryLock(content, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
    }

    return { deps, packages, importers };
  }

  /** @returns {number} */
  get size() {
    return this.#deps.size;
  }

  /** @returns {LockfileType | null} */
  get type() {
    return this.#type;
  }

  /** @returns {boolean} */
  get canTraverse() {
    return this.#canTraverse;
  }

  /**
   * Check if a dependency exists
   * @param {string} nameAtVersion - e.g., "lodash@4.17.21"
   * @returns {boolean}
   */
  has(nameAtVersion) {
    return this.#deps.has(nameAtVersion);
  }

  /**
   * Get a dependency by name@version
   * @param {string} nameAtVersion
   * @returns {Dependency | undefined}
   */
  get(nameAtVersion) {
    return this.#deps.get(nameAtVersion);
  }

  /** @returns {IterableIterator<Dependency>} */
  [Symbol.iterator]() {
    return this.#deps.values();
  }

  /** @returns {IterableIterator<Dependency>} */
  values() {
    return this.#deps.values();
  }

  /** @returns {IterableIterator<string>} */
  keys() {
    return this.#deps.keys();
  }

  /** @returns {IterableIterator<[string, Dependency]>} */
  entries() {
    return this.#deps.entries();
  }

  /**
   * Execute a callback for each dependency
   * @param {(dep: Dependency, key: string, set: FlatlockSet) => void} callback
   * @param {any} [thisArg]
   */
  forEach(callback, thisArg) {
    for (const [key, dep] of this.#deps) {
      callback.call(thisArg, dep, key, this);
    }
  }

  /**
   * Union of this set with another
   * @param {FlatlockSet} other
   * @returns {FlatlockSet}
   */
  union(other) {
    const deps = new Map(this.#deps);
    for (const [key, dep] of other.#deps) {
      if (!deps.has(key)) {
        deps.set(key, dep);
      }
    }
    return new FlatlockSet(INTERNAL, deps, null, null, null);
  }

  /**
   * Intersection of this set with another
   * @param {FlatlockSet} other
   * @returns {FlatlockSet}
   */
  intersection(other) {
    const deps = new Map();
    for (const [key, dep] of this.#deps) {
      if (other.has(key)) {
        deps.set(key, dep);
      }
    }
    return new FlatlockSet(INTERNAL, deps, null, null, null);
  }

  /**
   * Difference: elements in this set but not in other
   * @param {FlatlockSet} other
   * @returns {FlatlockSet}
   */
  difference(other) {
    const deps = new Map();
    for (const [key, dep] of this.#deps) {
      if (!other.has(key)) {
        deps.set(key, dep);
      }
    }
    return new FlatlockSet(INTERNAL, deps, null, null, null);
  }

  /**
   * Check if this set is a subset of another
   * @param {FlatlockSet} other
   * @returns {boolean}
   */
  isSubsetOf(other) {
    for (const key of this.#deps.keys()) {
      if (!other.has(key)) return false;
    }
    return true;
  }

  /**
   * Check if this set is a superset of another
   * @param {FlatlockSet} other
   * @returns {boolean}
   */
  isSupersetOf(other) {
    return other.isSubsetOf(this);
  }

  /**
   * Check if this set has no elements in common with another
   * @param {FlatlockSet} other
   * @returns {boolean}
   */
  isDisjointFrom(other) {
    for (const key of this.#deps.keys()) {
      if (other.has(key)) return false;
    }
    return true;
  }

  /**
   * Get transitive dependencies of a package.json
   *
   * For monorepos, provide workspacePath to get correct resolution.
   * Without workspacePath, assumes root package (hoisted deps only).
   *
   * NOTE: This method is only available on sets created directly from
   * fromPath/fromString. Sets created via union/intersection/difference
   * cannot use this method (canTraverse will be false).
   *
   * @param {PackageJson} packageJson - Parsed package.json
   * @param {DependenciesOfOptions} [options]
   * @returns {FlatlockSet}
   * @throws {Error} If called on a set that cannot traverse
   */
  dependenciesOf(packageJson, options = {}) {
    if (!packageJson || typeof packageJson !== 'object') {
      throw new TypeError('packageJson must be a non-null object');
    }

    if (!this.#canTraverse) {
      throw new Error(
        'dependenciesOf() requires lockfile data. ' +
          'This set was created via set operations and cannot traverse dependencies. ' +
          'Use dependenciesOf() on the original set before set operations.'
      );
    }

    const { workspacePath, dev = false, optional = true, peer = false } = options;

    // Collect seed dependencies from package.json
    const seeds = this.#collectSeeds(packageJson, { dev, optional, peer });

    // If pnpm with workspacePath, use importers to get resolved versions
    if (this.#type === Type.PNPM && workspacePath && this.#importers) {
      return this.#dependenciesOfPnpm(seeds, workspacePath, { dev, optional, peer });
    }

    // BFS traversal for npm/yarn (hoisted resolution)
    return this.#dependenciesOfHoisted(seeds, workspacePath);
  }

  /**
   * Collect seed dependency names from package.json
   * @param {PackageJson} packageJson
   * @param {{ dev: boolean, optional: boolean, peer: boolean }} options
   * @returns {Set<string>}
   */
  #collectSeeds(packageJson, { dev, optional, peer }) {
    const seeds = new Set();

    for (const name of Object.keys(packageJson.dependencies || {})) {
      seeds.add(name);
    }
    if (dev) {
      for (const name of Object.keys(packageJson.devDependencies || {})) {
        seeds.add(name);
      }
    }
    if (optional) {
      for (const name of Object.keys(packageJson.optionalDependencies || {})) {
        seeds.add(name);
      }
    }
    if (peer) {
      for (const name of Object.keys(packageJson.peerDependencies || {})) {
        seeds.add(name);
      }
    }

    return seeds;
  }

  /**
   * pnpm-specific resolution using importers
   * @param {Set<string>} seeds
   * @param {string} workspacePath
   * @param {{ dev: boolean, optional: boolean, peer: boolean }} options
   * @returns {FlatlockSet}
   */
  #dependenciesOfPnpm(seeds, workspacePath, { dev, optional, peer }) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();
    /** @type {Set<string>} */
    const visited = new Set();
    /** @type {string[]} */
    const queue = [...seeds];

    // Get resolved versions from importers
    const importer = this.#importers?.[workspacePath] || this.#importers?.['.'] || {};
    const resolvedDeps = {
      ...importer.dependencies,
      ...(dev ? importer.devDependencies : {}),
      ...(optional ? importer.optionalDependencies : {}),
      ...(peer ? importer.peerDependencies : {})
    };

    while (queue.length > 0) {
      const name = /** @type {string} */ (queue.shift());
      if (visited.has(name)) continue;
      visited.add(name);

      // Get resolved version from importer or find in deps
      const version = resolvedDeps[name];
      let dep;

      if (version) {
        // pnpm stores version directly or as specifier
        dep = this.get(`${name}@${version}`) || this.#findByName(name);
      } else {
        dep = this.#findByName(name);
      }

      if (!dep) continue;

      const key = `${dep.name}@${dep.version}`;
      result.set(key, dep);

      // Get transitive deps
      const pkgKey = `/${dep.name}@${dep.version}`;
      const pkgEntry = this.#packages?.[pkgKey];
      if (pkgEntry) {
        for (const transName of Object.keys(pkgEntry.dependencies || {})) {
          if (!visited.has(transName)) queue.push(transName);
        }
        if (optional) {
          for (const transName of Object.keys(pkgEntry.optionalDependencies || {})) {
            if (!visited.has(transName)) queue.push(transName);
          }
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, this.#type);
  }

  /**
   * npm/yarn resolution with hoisting
   * @param {Set<string>} seeds
   * @param {string} [workspacePath]
   * @returns {FlatlockSet}
   */
  #dependenciesOfHoisted(seeds, workspacePath) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();
    /** @type {Set<string>} */
    const visited = new Set();
    /** @type {string[]} */
    const queue = [...seeds];

    while (queue.length > 0) {
      const name = /** @type {string} */ (queue.shift());
      if (visited.has(name)) continue;
      visited.add(name);

      // Find package: check workspace-local first, then hoisted
      const dep = this.#findPackage(name, workspacePath);
      if (!dep) continue;

      const key = `${dep.name}@${dep.version}`;
      result.set(key, dep);

      // Get transitive deps from raw lockfile
      const entry = this.#getPackageEntry(dep.name, dep.version, workspacePath);
      if (entry) {
        for (const transName of Object.keys(entry.dependencies || {})) {
          if (!visited.has(transName)) queue.push(transName);
        }
        for (const transName of Object.keys(entry.optionalDependencies || {})) {
          if (!visited.has(transName)) queue.push(transName);
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, this.#type);
  }

  /**
   * Find a package by name, checking workspace-local then hoisted
   * @param {string} name
   * @param {string} [workspacePath]
   * @returns {Dependency | undefined}
   */
  #findPackage(name, workspacePath) {
    if (this.#type === Type.NPM && workspacePath) {
      // Check workspace-local node_modules first
      const localKey = `${workspacePath}/node_modules/${name}`;
      const localEntry = this.#packages?.[localKey];
      if (localEntry?.version) {
        return this.get(`${name}@${localEntry.version}`);
      }
    }

    // Fall back to hoisted (root node_modules)
    return this.#findByName(name);
  }

  /**
   * Find a dependency by name (returns hoisted/first match)
   * @param {string} name
   * @returns {Dependency | undefined}
   */
  #findByName(name) {
    // For npm, check root node_modules path first
    if (this.#type === Type.NPM) {
      const rootKey = `node_modules/${name}`;
      const entry = this.#packages?.[rootKey];
      if (entry?.version) {
        return this.get(`${name}@${entry.version}`);
      }
    }

    // Fallback: iterate deps (may return arbitrary version if multiple)
    for (const dep of this.#deps.values()) {
      if (dep.name === name) return dep;
    }
    return undefined;
  }

  /**
   * Get raw package entry for transitive dep lookup
   * @param {string} name
   * @param {string} version
   * @param {string} [workspacePath]
   * @returns {any}
   */
  #getPackageEntry(name, version, workspacePath) {
    if (!this.#packages) return null;

    switch (this.#type) {
      case Type.NPM: {
        // Check workspace-local first
        if (workspacePath) {
          const localKey = `${workspacePath}/node_modules/${name}`;
          if (this.#packages[localKey]) return this.#packages[localKey];
        }
        // Fall back to hoisted
        return this.#packages[`node_modules/${name}`] || null;
      }
      case Type.PNPM: {
        return this.#packages[`/${name}@${version}`] || null;
      }
      case Type.YARN_CLASSIC: {
        for (const [key, entry] of Object.entries(this.#packages)) {
          if (entry.version === version) {
            const keyName = parseYarnClassicKey(key);
            if (keyName === name) return entry;
          }
        }
        return null;
      }
      case Type.YARN_BERRY: {
        for (const [key, entry] of Object.entries(this.#packages)) {
          if (entry.version === version) {
            const keyName = parseYarnBerryKey(key);
            if (keyName === name) return entry;
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Convert to array
   * @returns {Dependency[]}
   */
  toArray() {
    return [...this.#deps.values()];
  }
}
