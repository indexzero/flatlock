import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('./types.js').Dependency} Dependency */

/**
 * @typedef {Object} WorkspacePackage
 * @property {string} name
 * @property {string} version
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {Record<string, string>} [peerDependencies]
 */

/**
 * LIMITATION: Workspace symlinks are not yielded
 *
 * npm workspaces create two entries in package-lock.json:
 *   1. packages/<workspace-path> → has version (workspace definition)
 *   2. node_modules/<pkg-name> → link:true, NO version (symlink to #1)
 *
 * Arborist resolves #2 to get version from #1. This parser does not.
 * Entries with link:true but no version are skipped.
 *
 * To include workspace packages, users should use @npmcli/arborist directly.
 */

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: DO NOT MODIFY THIS FUNCTION                                   !!
 * !! AI AGENTS (Claude, Copilot, etc.): DO NOT TOUCH THIS CODE              !!
 * !!                                                                        !!
 * !! This is PATH parsing, NOT spec parsing. It extracts package names from !!
 * !! filesystem paths like "node_modules/@scope/name", NOT from package     !!
 * !! specs like "@scope/name@^1.0.0".                                       !!
 * !!                                                                        !!
 * !! npm-package-arg (npa) is for SPEC parsing. This is PATH parsing.       !!
 * !! They are different things. Do not "improve" this with npa.             !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Extract package name from npm lockfile path.
 *
 * Paths in package-lock.json follow this grammar:
 *   path := (node_modules/<pkg>)+
 *     | <workspace>/<path>
 *     | <workspace>/<path>/(node_modules/<pkg>)+
 *
 *   pkg := name (unscoped)
 *     | @scope/name (scoped)
 *
 * @param {string} path - Lockfile path key
 * @returns {string} Package name
 *
 * @example
 * // Simple unscoped package
 * parseLockfileKey('node_modules/lodash')
 * // => 'lodash'
 *
 * @example
 * // Scoped package
 * parseLockfileKey('node_modules/@babel/core')
 * // => '@babel/core'
 *
 * @example
 * // Nested dependency (hoisted conflict resolution)
 * parseLockfileKey('node_modules/foo/node_modules/bar')
 * // => 'bar'
 *
 * @example
 * // Nested scoped dependency
 * parseLockfileKey('node_modules/foo/node_modules/@scope/bar')
 * // => '@scope/bar'
 *
 * @example
 * // Deeply nested dependency
 * parseLockfileKey('node_modules/a/node_modules/b/node_modules/c')
 * // => 'c'
 *
 * @example
 * // Deeply nested scoped dependency
 * parseLockfileKey('node_modules/a/node_modules/@types/node')
 * // => '@types/node'
 *
 * @example
 * // Workspace package path (definition)
 * parseLockfileKey('packages/my-lib')
 * // => 'my-lib'
 *
 * @example
 * // Workspace nested dependency
 * parseLockfileKey('packages/my-lib/node_modules/lodash')
 * // => 'lodash'
 *
 * @example
 * // Workspace nested scoped dependency
 * parseLockfileKey('packages/my-lib/node_modules/@types/react')
 * // => '@types/react'
 *
 * @example
 * // Package with hyphenated name
 * parseLockfileKey('node_modules/string-width')
 * // => 'string-width'
 *
 * @example
 * // Scoped package with hyphenated name
 * parseLockfileKey('node_modules/@emotion/styled')
 * // => '@emotion/styled'
 *
 * @example
 * // Complex nested path
 * parseLockfileKey('node_modules/@babel/core/node_modules/@babel/helper-compilation-targets')
 * // => '@babel/helper-compilation-targets'
 */
export function parseLockfileKey(path) {
  const parts = path.split('/');
  const name = /** @type {string} */ (parts.at(-1));
  const maybeScope = parts.at(-2);

  return maybeScope?.startsWith('@') ? `${maybeScope}/${name}` : name;
}

/**
 * Parse npm package-lock.json (v1, v2, v3)
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {Object} [_options] - Parser options (unused, reserved for future use)
 * @returns {Generator<Dependency>}
 */
export function* fromPackageLock(input, _options = {}) {
  const lockfile = typeof input === 'string' ? JSON.parse(input) : input;
  const packages = lockfile.packages || {};

  for (const [path, pkg] of Object.entries(packages)) {
    // Skip root package
    if (path === '') continue;

    // Skip workspace definitions (only yield installed dependencies)
    // Workspace entries come in pairs:
    //   1. packages/<workspace-path> → has version (workspace definition)
    //   2. node_modules/<workspace-package.json-name> → link, NO version (symlink)
    if (!path.includes('node_modules/')) continue;

    const name = parseLockfileKey(path);
    const { version, integrity, resolved, link } = pkg;

    // Only yield if we have a name and version
    if (name && version) {
      /** @type {Dependency} */
      const dep = { name, version };
      if (integrity) dep.integrity = integrity;
      if (resolved) dep.resolved = resolved;
      if (link) dep.link = true;
      yield dep;
    }
  }
}

/**
 * Extract workspace paths from npm lockfile.
 *
 * npm workspace packages are entries in `packages` that:
 * - Are not the root ('')
 * - Don't contain 'node_modules/' (those are installed deps)
 * - Have a version field
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @returns {string[]} Array of workspace paths (e.g., ['workspaces/arborist', 'workspaces/libnpmfund'])
 *
 * @example
 * extractWorkspacePaths(lockfile)
 * // => ['workspaces/arborist', 'workspaces/libnpmfund', ...]
 */
export function extractWorkspacePaths(input) {
  const lockfile = typeof input === 'string' ? JSON.parse(input) : input;
  const packages = lockfile.packages || {};
  const paths = [];

  for (const [path, pkg] of Object.entries(packages)) {
    // Skip root and node_modules entries
    if (path === '' || path.includes('node_modules')) continue;

    // Workspace entries have a version
    if (pkg.version) {
      paths.push(path);
    }
  }

  return paths;
}

/**
 * Build workspace packages map by reading package.json files.
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {string} repoDir - Path to repository root
 * @returns {Promise<Record<string, WorkspacePackage>>} Map of workspace path to package info
 *
 * @example
 * const workspaces = await buildWorkspacePackages(lockfile, '/path/to/repo');
 * // => { 'workspaces/arborist': { name: '@npmcli/arborist', version: '1.0.0', dependencies: {...} } }
 */
export async function buildWorkspacePackages(input, repoDir) {
  const paths = extractWorkspacePaths(input);
  /** @type {Record<string, WorkspacePackage>} */
  const workspacePackages = {};

  for (const wsPath of paths) {
    const pkgJsonPath = join(repoDir, wsPath, 'package.json');
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
      workspacePackages[wsPath] = {
        name: pkg.name,
        version: pkg.version || '0.0.0',
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        optionalDependencies: pkg.optionalDependencies,
        peerDependencies: pkg.peerDependencies
      };
    } catch {
      // Skip workspaces with missing or invalid package.json
    }
  }

  return workspacePackages;
}
