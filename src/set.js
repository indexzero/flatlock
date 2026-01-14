import { readFile } from 'node:fs/promises';
import { parseSyml } from '@yarnpkg/parsers';
import yaml from 'js-yaml';
import { detectType, Type } from './detect.js';
import {
  fromPackageLock,
  fromPnpmLock,
  fromYarnBerryLock,
  fromYarnClassicLock,
  parseYarnBerryKey,
  parseYarnClassic,
  parseYarnClassicKey
} from './parsers/index.js';

/**
 * @typedef {import('./parsers/npm.js').Dependency} Dependency
 * @typedef {import('./detect.js').LockfileType} LockfileType
 */

/**
 * @typedef {Object} WorkspacePackage
 * @property {string} name - Package name (e.g., '@vue/shared')
 * @property {string} version - Package version (e.g., '3.5.26')
 */

/**
 * @typedef {Object} DependenciesOfOptions
 * @property {string} [workspacePath] - Path to workspace (e.g., 'packages/foo')
 * @property {boolean} [dev=false] - Include devDependencies
 * @property {boolean} [optional=true] - Include optionalDependencies
 * @property {boolean} [peer=false] - Include peerDependencies (default false: peers are provided by consumer)
 * @property {Record<string, WorkspacePackage>} [workspacePackages] - Map of workspace path to package info for resolving workspace links
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

  /** @type {Record<string, any> | null} Snapshots (pnpm v9) */
  #snapshots = null;

  /** @type {LockfileType | null} */
  #type = null;

  /** @type {boolean} Whether this set supports dependenciesOf */
  #canTraverse = false;

  /**
   * @param {symbol} internal - Must be INTERNAL symbol
   * @param {Map<string, Dependency>} deps
   * @param {LockfilePackages | null} packages
   * @param {LockfileImporters | null} importers
   * @param {Record<string, any> | null} snapshots
   * @param {LockfileType | null} type
   */
  constructor(internal, deps, packages, importers, snapshots, type) {
    if (internal !== INTERNAL) {
      throw new Error(
        'FlatlockSet cannot be constructed directly. Use FlatlockSet.fromPath() or FlatlockSet.fromString()'
      );
    }
    this.#deps = deps;
    this.#packages = packages;
    this.#importers = importers;
    this.#snapshots = snapshots;
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
    const { deps, packages, importers, snapshots } = FlatlockSet.#parseAll(content, type, options);

    return new FlatlockSet(INTERNAL, deps, packages, importers, snapshots, type);
  }

  /**
   * Parse lockfile once, returning both processed deps and raw data
   * @param {string} content
   * @param {LockfileType} type
   * @param {FromStringOptions} options
   * @returns {{ deps: Map<string, Dependency>, packages: LockfilePackages, importers: LockfileImporters | null, snapshots: Record<string, any> | null }}
   */
  static #parseAll(content, type, options) {
    /** @type {Map<string, Dependency>} */
    const deps = new Map();
    /** @type {LockfilePackages} */
    let packages = {};
    /** @type {LockfileImporters | null} */
    let importers = null;
    /** @type {Record<string, any> | null} */
    let snapshots = null;

    switch (type) {
      case Type.NPM: {
        const lockfile = JSON.parse(content);
        packages = lockfile.packages || {};
        // Pass pre-parsed lockfile object to avoid re-parsing
        for (const dep of fromPackageLock(lockfile, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.PNPM: {
        /** @type {any} */
        const lockfile = yaml.load(content);
        packages = lockfile.packages || {};
        importers = lockfile.importers || null;
        snapshots = lockfile.snapshots || null;
        // Pass pre-parsed lockfile object to avoid re-parsing
        for (const dep of fromPnpmLock(lockfile, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.YARN_CLASSIC: {
        const result = parseYarnClassic(content);
        packages = result.object || {};
        // Pass pre-parsed lockfile object to avoid re-parsing
        for (const dep of fromYarnClassicLock(packages, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
      case Type.YARN_BERRY: {
        packages = parseSyml(content);
        // Pass pre-parsed lockfile object to avoid re-parsing
        for (const dep of fromYarnBerryLock(packages, options)) {
          deps.set(`${dep.name}@${dep.version}`, dep);
        }
        break;
      }
    }

    return { deps, packages, importers, snapshots };
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
    return new FlatlockSet(INTERNAL, deps, null, null, null, null);
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
    return new FlatlockSet(INTERNAL, deps, null, null, null, null);
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
    return new FlatlockSet(INTERNAL, deps, null, null, null, null);
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

    const {
      workspacePath,
      dev = false,
      optional = true,
      peer = false,
      workspacePackages
    } = options;

    // Collect seed dependencies from package.json
    const seeds = this.#collectSeeds(packageJson, { dev, optional, peer });

    // If pnpm with workspacePath, use importers to get resolved versions
    if (this.#type === Type.PNPM && workspacePath && this.#importers) {
      return this.#dependenciesOfPnpm(seeds, workspacePath, {
        dev,
        optional,
        peer,
        ...(workspacePackages && { workspacePackages })
      });
    }

    // If yarn berry with workspace context, use workspace-aware resolution
    // Auto-extract workspacePackages from lockfile if not provided
    if (this.#type === Type.YARN_BERRY && workspacePath) {
      const wsPackages = workspacePackages || this.#extractYarnBerryWorkspaces();
      return this.#dependenciesOfYarnBerry(seeds, packageJson, {
        dev,
        optional,
        peer,
        workspacePackages: wsPackages
      });
    }

    // If yarn classic with workspace packages, use workspace-aware resolution
    if (this.#type === Type.YARN_CLASSIC && workspacePackages) {
      return this.#dependenciesOfYarnClassic(seeds, packageJson, {
        dev,
        optional,
        peer,
        workspacePackages
      });
    }

    // If npm with workspace packages and workspacePath, use workspace-aware resolution
    if (this.#type === Type.NPM && workspacePackages && workspacePath) {
      return this.#dependenciesOfNpm(seeds, workspacePath, {
        dev,
        optional,
        peer,
        workspacePackages
      });
    }

    // BFS traversal for npm/yarn-classic (hoisted resolution)
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
   *
   * pnpm monorepos have workspace packages linked via link: protocol.
   * To get the full dependency tree, we need to:
   * 1. Follow workspace links recursively, emitting workspace packages
   * 2. Collect external deps from each visited workspace
   * 3. Traverse the packages/snapshots section for transitive deps
   *
   * @param {Set<string>} _seeds - Unused, we derive from importers
   * @param {string} workspacePath
   * @param {{ dev: boolean, optional: boolean, peer: boolean, workspacePackages?: Record<string, {name: string, version: string}> }} options
   * @returns {FlatlockSet}
   */
  #dependenciesOfPnpm(_seeds, workspacePath, { dev, optional, peer, workspacePackages }) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();

    // Phase 1: Follow workspace links, emit workspace packages, collect external deps
    const externalDeps = new Set();
    const visitedWorkspaces = new Set();
    const workspaceQueue = [workspacePath];

    while (workspaceQueue.length > 0) {
      const ws = /** @type {string} */ (workspaceQueue.shift());
      if (visitedWorkspaces.has(ws)) continue;
      visitedWorkspaces.add(ws);

      // If we have workspace package info, emit this workspace as a dependency
      // (except for the starting workspace - dependenciesOf returns deps, not self)
      if (workspacePackages && ws !== workspacePath) {
        const wsPkg = workspacePackages[ws];
        if (wsPkg) {
          result.set(`${wsPkg.name}@${wsPkg.version}`, {
            name: wsPkg.name,
            version: wsPkg.version
          });
        }
      }

      const importer = this.#importers?.[ws];
      if (!importer) continue;

      // Collect dependencies from importer
      // v9 format: { specifier: '...', version: '...' }
      // older format: version string directly
      const depSections = [importer.dependencies];
      if (dev) depSections.push(importer.devDependencies);
      if (optional) depSections.push(importer.optionalDependencies);
      if (peer) depSections.push(importer.peerDependencies);

      for (const deps of depSections) {
        if (!deps) continue;
        for (const [name, spec] of Object.entries(deps)) {
          // Handle v9 object format or older string format
          const version =
            typeof spec === 'object' && spec !== null
              ? /** @type {{version?: string}} */ (spec).version
              : /** @type {string} */ (spec);

          if (!version) continue;

          if (version.startsWith('link:')) {
            // Workspace link - resolve and follow
            const linkedPath = version.slice(5); // Remove 'link:'
            const resolvedPath = this.#resolveRelativePath(ws, linkedPath);
            if (!visitedWorkspaces.has(resolvedPath)) {
              workspaceQueue.push(resolvedPath);
            }
          } else {
            // External dependency
            externalDeps.add(name);
          }
        }
      }
    }

    // Phase 2: Traverse external deps and their transitive dependencies
    // In v9, dependencies are in snapshots; in older versions, they're in packages
    const depsSource = this.#snapshots || this.#packages || {};
    const visitedDeps = new Set();
    const depQueue = [...externalDeps];

    while (depQueue.length > 0) {
      const name = /** @type {string} */ (depQueue.shift());
      if (visitedDeps.has(name)) continue;
      visitedDeps.add(name);

      // Find this package in our deps map
      const dep = this.#findByName(name);
      if (dep) {
        result.set(`${dep.name}@${dep.version}`, dep);

        // Find transitive deps from snapshots/packages
        // Keys are like "name@version" or "@scope/name@version" or with peer deps suffix
        // In pnpm v9, same package can have multiple entries with different peer configurations
        // e.g., "ts-api-utils@1.2.1(typescript@4.9.5)" and "ts-api-utils@1.2.1(typescript@5.3.3)"
        // We must process ALL matching entries to capture deps from all peer variants
        for (const [key, pkg] of Object.entries(depsSource)) {
          const keyPackageName = this.#extractPnpmPackageName(key);
          if (keyPackageName === name) {
            // Found a package entry, get its dependencies
            for (const transName of Object.keys(pkg.dependencies || {})) {
              if (!visitedDeps.has(transName)) {
                depQueue.push(transName);
              }
            }
            if (optional) {
              for (const transName of Object.keys(pkg.optionalDependencies || {})) {
                if (!visitedDeps.has(transName)) {
                  depQueue.push(transName);
                }
              }
            }
            // NOTE: No break - continue processing all peer variants of this package
          }
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, null, this.#type);
  }

  /**
   * npm-specific resolution with workspace support
   *
   * npm monorepos have workspace packages that are symlinked from node_modules.
   * Packages can have nested node_modules with different versions.
   *
   * @param {Set<string>} _seeds - Seed dependency names (unused, derived from lockfile)
   * @param {string} workspacePath - Path to workspace (e.g., 'workspaces/arborist')
   * @param {{ dev: boolean, optional: boolean, peer: boolean, workspacePackages: Record<string, {name: string, version: string}> }} options
   * @returns {FlatlockSet}
   */
  #dependenciesOfNpm(_seeds, workspacePath, { dev, optional, peer, workspacePackages }) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();

    // Build name -> workspace path mapping
    const nameToWorkspace = new Map();
    for (const [wsPath, pkg] of Object.entries(workspacePackages)) {
      nameToWorkspace.set(pkg.name, wsPath);
    }

    // Queue entries: { name, contextPath } where contextPath is where to look for nested node_modules
    // contextPath is either a workspace path or a node_modules package path
    const queue = [];
    const visited = new Set(); // Track "name@contextPath" to handle same package at different contexts

    // Phase 1: Process workspace packages
    const visitedWorkspaces = new Set();
    const workspaceQueue = [workspacePath];

    while (workspaceQueue.length > 0) {
      const wsPath = /** @type {string} */ (workspaceQueue.shift());
      if (visitedWorkspaces.has(wsPath)) continue;
      visitedWorkspaces.add(wsPath);

      const wsEntry = this.#packages?.[wsPath];
      if (!wsEntry) continue;

      // Emit this workspace package (except starting workspace)
      // Name comes from workspacePackages map since lockfile may not have it
      if (wsPath !== workspacePath) {
        const wsPkg = workspacePackages[wsPath];
        if (wsPkg?.name && wsPkg?.version) {
          result.set(`${wsPkg.name}@${wsPkg.version}`, {
            name: wsPkg.name,
            version: wsPkg.version
          });
        }
      }

      // Collect dependencies
      const depSections = [wsEntry.dependencies];
      if (dev) depSections.push(wsEntry.devDependencies);
      if (optional) depSections.push(wsEntry.optionalDependencies);
      if (peer) depSections.push(wsEntry.peerDependencies);

      for (const deps of depSections) {
        if (!deps) continue;
        for (const name of Object.keys(deps)) {
          if (nameToWorkspace.has(name)) {
            const linkedWsPath = nameToWorkspace.get(name);
            if (!visitedWorkspaces.has(linkedWsPath)) {
              workspaceQueue.push(linkedWsPath);
            }
          } else {
            // Add to queue with workspace context
            queue.push({ name, contextPath: wsPath });
          }
        }
      }
    }

    // Phase 2: Traverse external dependencies with context-aware resolution
    while (queue.length > 0) {
      const { name, contextPath } = /** @type {{name: string, contextPath: string}} */ (
        queue.shift()
      );
      const visitKey = `${name}@${contextPath}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      // Check if this is a workspace package
      if (nameToWorkspace.has(name)) {
        const wsPath = nameToWorkspace.get(name);
        const wsEntry = this.#packages?.[wsPath];
        if (wsEntry?.name && wsEntry?.version) {
          result.set(`${wsEntry.name}@${wsEntry.version}`, {
            name: wsEntry.name,
            version: wsEntry.version
          });
        }
        continue;
      }

      // Resolve package using npm's resolution algorithm:
      // 1. Check nested node_modules at contextPath
      // 2. Walk up the path checking each parent's node_modules
      // 3. Fall back to root node_modules
      let entry = null;
      let pkgPath = null;

      // Try nested node_modules at context path
      const nestedKey = `${contextPath}/node_modules/${name}`;
      if (this.#packages?.[nestedKey]) {
        entry = this.#packages[nestedKey];
        pkgPath = nestedKey;
      }

      // Walk up context path looking for the package
      if (!entry) {
        const parts = contextPath.split('/');
        while (parts.length > 0) {
          const parentKey = `${parts.join('/')}/node_modules/${name}`;
          if (this.#packages?.[parentKey]) {
            entry = this.#packages[parentKey];
            pkgPath = parentKey;
            break;
          }
          parts.pop();
        }
      }

      // Fall back to root node_modules
      if (!entry) {
        const rootKey = `node_modules/${name}`;
        if (this.#packages?.[rootKey]) {
          entry = this.#packages[rootKey];
          pkgPath = rootKey;
        }
      }

      if (!entry?.version) continue;

      // Follow symlinks for workspace packages
      if (entry.link && entry.resolved) {
        const resolvedEntry = this.#packages?.[entry.resolved];
        if (resolvedEntry?.version) {
          entry = resolvedEntry;
          pkgPath = entry.resolved;
        }
      }

      result.set(`${name}@${entry.version}`, { name, version: entry.version });

      // Queue transitive dependencies with this package's path as context
      // The context should be the directory containing this package's node_modules
      const depContext = pkgPath;

      for (const transName of Object.keys(entry.dependencies || {})) {
        queue.push({ name: transName, contextPath: depContext });
      }
      if (optional) {
        for (const transName of Object.keys(entry.optionalDependencies || {})) {
          queue.push({ name: transName, contextPath: depContext });
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, null, this.#type);
  }

  /**
   * Extract package name from a pnpm snapshot/packages key.
   * Handles formats like:
   * - name@version
   * - @scope/name@version
   * - name@version(peer@peerVersion)
   * - @scope/name@version(peer@peerVersion)
   * @param {string} key - The snapshot key
   * @returns {string} The package name
   */
  #extractPnpmPackageName(key) {
    // For scoped packages (@scope/name), find the second @
    if (key.startsWith('@')) {
      const secondAt = key.indexOf('@', 1);
      return secondAt === -1 ? key : key.slice(0, secondAt);
    }
    // For unscoped packages, find the first @
    const firstAt = key.indexOf('@');
    return firstAt === -1 ? key : key.slice(0, firstAt);
  }

  /**
   * Resolve a relative path from a workspace path
   * @param {string} from - Current workspace path (e.g., 'packages/vue')
   * @param {string} relative - Relative path (e.g., '../compiler-dom')
   * @returns {string} Resolved path (e.g., 'packages/compiler-dom')
   */
  #resolveRelativePath(from, relative) {
    const parts = from.split('/');
    const relParts = relative.split('/');

    for (const p of relParts) {
      if (p === '..') {
        parts.pop();
      } else if (p !== '.') {
        parts.push(p);
      }
    }

    return parts.join('/');
  }

  /**
   * Yarn berry-specific resolution with workspace support
   *
   * Yarn berry workspace packages use `workspace:*` or `workspace:^` specifiers.
   * These need to be resolved to actual package versions from workspacePackages.
   *
   * @param {Set<string>} _seeds - Seed dependency names (unused, derived from packageJson)
   * @param {PackageJson} packageJson - The workspace's package.json
   * @param {{ dev: boolean, optional: boolean, peer: boolean, workspacePackages: Record<string, {name: string, version: string}> }} options
   * @returns {FlatlockSet}
   */
  #dependenciesOfYarnBerry(_seeds, packageJson, { dev, optional, peer, workspacePackages }) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();
    /** @type {Set<string>} */
    const visited = new Set(); // Track by name@version

    // Build a map of package name -> workspace path for quick lookup
    const nameToWorkspace = new Map();
    for (const [wsPath, pkg] of Object.entries(workspacePackages)) {
      nameToWorkspace.set(pkg.name, { path: wsPath, ...pkg });
    }

    // Get dependency specifiers from package.json
    const rootSpecs = {
      ...packageJson.dependencies,
      ...(dev ? packageJson.devDependencies : {}),
      ...(optional ? packageJson.optionalDependencies : {}),
      ...(peer ? packageJson.peerDependencies : {})
    };

    // Queue items are {name, spec} pairs
    /** @type {Array<{name: string, spec: string}>} */
    const queue = Object.entries(rootSpecs).map(([name, spec]) => ({ name, spec }));

    while (queue.length > 0) {
      const { name, spec } = /** @type {{name: string, spec: string}} */ (queue.shift());

      const isWorkspaceDep = typeof spec === 'string' && spec.startsWith('workspace:');

      let dep;
      let entry;

      if (isWorkspaceDep && nameToWorkspace.has(name)) {
        // Use workspace package info
        const wsPkg = nameToWorkspace.get(name);
        dep = { name: wsPkg.name, version: wsPkg.version };
        entry = this.#getYarnWorkspaceEntry(name);
      } else if (nameToWorkspace.has(name)) {
        // It's a workspace package referenced transitively
        const wsPkg = nameToWorkspace.get(name);
        dep = { name: wsPkg.name, version: wsPkg.version };
        entry = this.#getYarnWorkspaceEntry(name);
      } else {
        // Regular npm dependency - use spec to find correct version
        entry = this.#getYarnBerryEntryBySpec(name, spec);
        if (entry) {
          dep = { name, version: entry.version };
        } else {
          // Fallback to first match
          dep = this.#findByName(name);
          if (dep) {
            entry = this.#getYarnBerryEntry(name, dep.version);
          }
        }
      }

      if (!dep) continue;

      const key = `${dep.name}@${dep.version}`;
      if (visited.has(key)) continue;
      visited.add(key);

      result.set(key, dep);

      // Get transitive deps
      if (entry) {
        for (const [transName, transSpec] of Object.entries(entry.dependencies || {})) {
          queue.push({ name: transName, spec: transSpec });
        }
        if (optional) {
          for (const [transName, transSpec] of Object.entries(entry.optionalDependencies || {})) {
            queue.push({ name: transName, spec: transSpec });
          }
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, null, this.#type);
  }

  /**
   * Yarn classic-specific resolution with workspace support
   *
   * Yarn classic workspace packages are NOT in the lockfile - they're resolved
   * from the filesystem. So when a dependency isn't found in the lockfile,
   * we check if it's a workspace package.
   *
   * @param {Set<string>} seeds - Seed dependency names from package.json
   * @param {PackageJson} _packageJson - The workspace's package.json (unused)
   * @param {{ dev: boolean, optional: boolean, peer: boolean, workspacePackages: Record<string, {name: string, version: string}> }} options
   * @returns {FlatlockSet}
   */
  #dependenciesOfYarnClassic(seeds, _packageJson, { dev, optional, peer, workspacePackages }) {
    /** @type {Map<string, Dependency>} */
    const result = new Map();
    /** @type {Set<string>} */
    const visited = new Set();
    /** @type {string[]} */
    const queue = [...seeds];

    // Build a map of package name -> workspace info for quick lookup
    const nameToWorkspace = new Map();
    for (const [wsPath, pkg] of Object.entries(workspacePackages)) {
      nameToWorkspace.set(pkg.name, { path: wsPath, ...pkg });
    }

    while (queue.length > 0) {
      const name = /** @type {string} */ (queue.shift());
      if (visited.has(name)) continue;
      visited.add(name);

      let dep;
      let entry;

      // Check if this is a workspace package
      if (nameToWorkspace.has(name)) {
        // Use workspace package info
        const wsPkg = nameToWorkspace.get(name);
        dep = { name: wsPkg.name, version: wsPkg.version };
        // Workspace packages don't have lockfile entries in yarn classic
        entry = null;
      } else {
        // Regular npm dependency - find in lockfile
        dep = this.#findByName(name);
        if (dep) {
          entry = this.#getYarnClassicEntry(name, dep.version);
        }
      }

      if (!dep) continue;

      const key = `${dep.name}@${dep.version}`;
      result.set(key, dep);

      // Get transitive deps from lockfile entry
      if (entry) {
        for (const transName of Object.keys(entry.dependencies || {})) {
          if (!visited.has(transName)) queue.push(transName);
        }
        if (optional) {
          for (const transName of Object.keys(entry.optionalDependencies || {})) {
            if (!visited.has(transName)) queue.push(transName);
          }
        }
        if (peer) {
          for (const transName of Object.keys(entry.peerDependencies || {})) {
            if (!visited.has(transName)) queue.push(transName);
          }
        }
      }
    }

    return new FlatlockSet(INTERNAL, result, null, null, null, this.#type);
  }

  /**
   * Find a yarn classic entry by name and version
   * @param {string} name
   * @param {string} version
   * @returns {any}
   */
  #getYarnClassicEntry(name, version) {
    if (!this.#packages) return null;
    for (const [key, entry] of Object.entries(this.#packages)) {
      if (entry.version === version) {
        const keyName = parseYarnClassicKey(key);
        if (keyName === name) return entry;
      }
    }
    return null;
  }

  /**
   * Find a yarn berry workspace entry by package name
   * @param {string} name
   * @returns {any}
   */
  #getYarnWorkspaceEntry(name) {
    if (!this.#packages) return null;
    for (const [key, entry] of Object.entries(this.#packages)) {
      if (
        key.includes('@workspace:') &&
        (key.startsWith(`${name}@`) || key.includes(`/${name}@`))
      ) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Find a yarn berry npm entry by name and version
   * @param {string} name
   * @param {string} version
   * @returns {any}
   */
  #getYarnBerryEntry(name, version) {
    if (!this.#packages) return null;
    // Yarn berry keys are like "@babel/types@npm:^7.24.0" and resolution is "@babel/types@npm:7.24.0"
    for (const [key, entry] of Object.entries(this.#packages)) {
      if (entry.version === version && key.includes(`${name}@`)) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Find a yarn berry entry by spec (e.g., "npm:^3.1.0")
   * Yarn berry keys contain the spec like "p-limit@npm:^3.1.0"
   * @param {string} name
   * @param {string} spec - The spec like "npm:^3.1.0" or "^3.1.0"
   * @returns {any}
   */
  #getYarnBerryEntryBySpec(name, spec) {
    if (!this.#packages || !spec) return null;

    // Normalize spec - yarn specs may or may not have npm: prefix
    // Key format: "p-limit@npm:^3.0.2, p-limit@npm:^3.1.0"
    const normalizedSpec = spec.startsWith('npm:') ? spec : `npm:${spec}`;
    const searchKey = `${name}@${normalizedSpec}`;

    for (const [key, entry] of Object.entries(this.#packages)) {
      // Key can have multiple specs comma-separated
      if (key.includes(searchKey)) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Extract workspace packages from yarn berry lockfile.
   * Yarn berry lockfiles contain workspace entries with `@workspace:` protocol.
   * @returns {Record<string, {name: string, version: string}>}
   */
  #extractYarnBerryWorkspaces() {
    /** @type {Record<string, {name: string, version: string}>} */
    const workspacePackages = {};

    for (const [key, entry] of Object.entries(this.#packages || {})) {
      if (!key.includes('@workspace:')) continue;

      // Handle potentially multiple descriptors (comma-separated)
      const descriptors = key.split(', ');
      for (const descriptor of descriptors) {
        if (!descriptor.includes('@workspace:')) continue;

        // Find @workspace: and extract path after it
        const wsIndex = descriptor.indexOf('@workspace:');
        const path = descriptor.slice(wsIndex + '@workspace:'.length);

        // Extract name - everything before @workspace:
        const name = descriptor.slice(0, wsIndex);

        workspacePackages[path] = {
          name,
          version: entry.version || '0.0.0'
        };
      }
    }

    return workspacePackages;
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

    return new FlatlockSet(INTERNAL, result, null, null, null, this.#type);
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
      // Follow workspace symlinks: link:true with resolved points to workspace
      if (entry?.link && entry?.resolved) {
        const workspaceEntry = this.#packages?.[entry.resolved];
        if (workspaceEntry?.version) {
          // Return a synthetic dependency for the workspace package
          return { name, version: workspaceEntry.version, link: true };
        }
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
        const hoistedKey = `node_modules/${name}`;
        const hoistedEntry = this.#packages[hoistedKey];
        if (hoistedEntry) {
          // Follow workspace symlinks to get the actual package entry
          if (hoistedEntry.link && hoistedEntry.resolved) {
            return this.#packages[hoistedEntry.resolved] || hoistedEntry;
          }
          return hoistedEntry;
        }
        return null;
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
