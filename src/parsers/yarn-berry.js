import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSyml } from '@yarnpkg/parsers';

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
 * Extract package name from yarn berry resolution field.
 *
 * The resolution field is the CANONICAL identifier and should be used instead of the key.
 * Keys can contain npm aliases (e.g., "string-width-cjs@npm:string-width@^4.2.0") while
 * the resolution always contains the actual package name (e.g., "string-width@npm:4.2.3").
 *
 * @param {string} resolution - Resolution field from lockfile entry
 * @returns {string | null} Package name or null if parsing fails
 *
 * @example
 * // Unscoped npm package
 * parseResolution('lodash@npm:4.17.21')
 * // => 'lodash'
 *
 * @example
 * // Scoped npm package
 * parseResolution('@babel/core@npm:7.24.0')
 * // => '@babel/core'
 *
 * @example
 * // Aliased package - resolution shows the REAL package name
 * // (key was "string-width-cjs@npm:string-width@^4.2.0")
 * parseResolution('string-width@npm:4.2.3')
 * // => 'string-width'
 *
 * @example
 * // Scoped aliased package - resolution shows the REAL package name
 * // (key was "@babel-baseline/core@npm:@babel/core@7.24.4")
 * parseResolution('@babel/core@npm:7.24.4')
 * // => '@babel/core'
 *
 * @example
 * // Patch protocol (nested protocols)
 * parseResolution('pkg@patch:pkg@npm:1.0.0#./patch')
 * // => 'pkg'
 *
 * @example
 * // Scoped package with patch protocol
 * parseResolution('@scope/pkg@patch:@scope/pkg@npm:1.0.0#./fix.patch')
 * // => '@scope/pkg'
 *
 * @example
 * // Workspace protocol
 * parseResolution('my-pkg@workspace:packages/my-pkg')
 * // => 'my-pkg'
 *
 * @example
 * // Scoped workspace package
 * parseResolution('@myorg/utils@workspace:packages/utils')
 * // => '@myorg/utils'
 *
 * @example
 * // Git protocol
 * parseResolution('my-lib@git:github.com/user/repo#commit-hash')
 * // => 'my-lib'
 *
 * @example
 * // Null/empty input
 * parseResolution(null)
 * // => null
 *
 * @example
 * // Empty string
 * parseResolution('')
 * // => null
 *
 * @example
 * // Portal protocol (symlink to external package)
 * parseResolution('@scope/external@portal:../external-pkg')
 * // => '@scope/external'
 */
export function parseResolution(resolution) {
  if (!resolution) return null;

  // Resolution format: name@protocol:version or @scope/name@protocol:version
  // Examples:
  //   "lodash@npm:4.17.21"
  //   "@babel/core@npm:7.24.0"
  //   "pkg@patch:pkg@npm:1.0.0#./patch"

  // Handle scoped packages: @scope/name@protocol:version
  if (resolution.startsWith('@')) {
    const slashIndex = resolution.indexOf('/');
    if (slashIndex !== -1) {
      // Find the @ after the scope/name
      const afterSlash = resolution.indexOf('@', slashIndex);
      if (afterSlash !== -1) {
        return resolution.slice(0, afterSlash);
      }
    }
  }

  // Handle unscoped packages: name@protocol:version
  const atIndex = resolution.indexOf('@');
  if (atIndex !== -1) {
    return resolution.slice(0, atIndex);
  }

  return null;
}

/**
 * Extract package name from yarn berry key (fallback for when resolution is unavailable).
 *
 * WARNING: Keys can contain npm aliases. Prefer parseResolution() when possible.
 * The key may return an alias name instead of the real package name.
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name (may be alias name, not canonical name)
 *
 * @example
 * // Simple unscoped package
 * parseLockfileKey('lodash@npm:^4.17.21')
 * // => 'lodash'
 *
 * @example
 * // Scoped package
 * parseLockfileKey('@babel/core@npm:^7.24.0')
 * // => '@babel/core'
 *
 * @example
 * // Multiple version ranges (comma-separated) - takes first entry
 * parseLockfileKey('@types/node@npm:^18.0.0, @types/node@npm:^20.0.0')
 * // => '@types/node'
 *
 * @example
 * // npm alias - returns the ALIAS name (not real package)
 * // Use parseResolution() for the real package name
 * parseLockfileKey('string-width-cjs@npm:string-width@^4.2.0')
 * // => 'string-width-cjs'
 *
 * @example
 * // Scoped npm alias
 * parseLockfileKey('@babel-baseline/core@npm:@babel/core@7.24.4')
 * // => '@babel-baseline/core'
 *
 * @example
 * // Workspace protocol
 * parseLockfileKey('my-pkg@workspace:packages/my-pkg')
 * // => 'my-pkg'
 *
 * @example
 * // Scoped workspace package
 * parseLockfileKey('@myorg/utils@workspace:.')
 * // => '@myorg/utils'
 *
 * @example
 * // Portal protocol
 * parseLockfileKey('external-pkg@portal:../some/path')
 * // => 'external-pkg'
 *
 * @example
 * // Link protocol
 * parseLockfileKey('linked-pkg@link:./local')
 * // => 'linked-pkg'
 *
 * @example
 * // Patch protocol (complex nested format)
 * parseLockfileKey('pkg@patch:pkg@npm:1.0.0#./patches/fix.patch')
 * // => 'pkg'
 *
 * @example
 * // Scoped patch
 * parseLockfileKey('@scope/pkg@patch:@scope/pkg@npm:1.0.0#./fix.patch')
 * // => '@scope/pkg'
 *
 * @example
 * // File protocol
 * parseLockfileKey('local-pkg@file:../local-package')
 * // => 'local-pkg'
 */
export function parseLockfileKey(key) {
  // Keys can have multiple comma-separated entries, take the first one
  const firstKey = key.split(',')[0].trim();

  // Find the FIRST protocol marker by checking all protocols and using earliest position
  // This is important because patch: entries contain npm: references inside them
  const protocols = ['@npm:', '@workspace:', '@portal:', '@link:', '@patch:', '@file:'];
  let earliestIndex = -1;

  for (const protocol of protocols) {
    const idx = firstKey.indexOf(protocol);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
    }
  }

  if (earliestIndex !== -1) {
    return firstKey.slice(0, earliestIndex);
  }

  // Fallback: for scoped packages, find the @ after the scope
  if (firstKey.startsWith('@')) {
    const slashIndex = firstKey.indexOf('/');
    if (slashIndex !== -1) {
      const afterSlash = firstKey.indexOf('@', slashIndex);
      if (afterSlash !== -1) {
        return firstKey.slice(0, afterSlash);
      }
    }
  }

  // For unscoped packages
  const atIndex = firstKey.indexOf('@');
  return atIndex !== -1 ? firstKey.slice(0, atIndex) : firstKey;
}

/**
 * Parse yarn.lock v2+ (berry)
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {Object} [_options] - Parser options (unused, reserved for future use)
 * @returns {Generator<Dependency>}
 */
export function* fromYarnBerryLock(input, _options = {}) {
  const lockfile = typeof input === 'string' ? parseSyml(input) : input;

  for (const [key, pkg] of Object.entries(lockfile)) {
    // Skip metadata
    if (key === '__metadata') continue;

    const { version, checksum, resolution } = pkg;

    // Check if this is a local/workspace entry (workspace:, portal:, or link: protocol)
    // The protocol appears after @ in both key and resolution: "pkg@workspace:..."
    const link =
      key.includes('@workspace:') ||
      key.includes('@portal:') ||
      key.includes('@link:') ||
      resolution?.includes('@workspace:') ||
      resolution?.includes('@portal:') ||
      resolution?.includes('@link:');

    // Skip workspace/link entries - flatlock only cares about external dependencies
    if (link) continue;

    // Use the resolution field for the package name - it's the canonical identifier
    // Keys can contain npm aliases (e.g., "string-width-cjs@npm:string-width@^4.2.0")
    // but resolution always has the actual package name (e.g., "string-width@npm:4.2.3")
    const name = parseResolution(resolution) || parseLockfileKey(key);

    if (name && version) {
      /** @type {Dependency} */
      const dep = { name, version };
      if (checksum) dep.integrity = checksum;
      if (resolution) dep.resolved = resolution;
      yield dep;
    }
  }
}

/**
 * Extract workspace paths from yarn berry lockfile.
 *
 * Yarn berry workspace entries use `@workspace:` protocol in keys.
 * Keys can have multiple comma-separated descriptors.
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @returns {string[]} Array of workspace paths (e.g., ['packages/foo', 'packages/bar'])
 *
 * @example
 * extractWorkspacePaths(lockfile)
 * // => ['packages/babel-core', 'packages/babel-parser', ...]
 */
export function extractWorkspacePaths(input) {
  const lockfile = typeof input === 'string' ? parseSyml(input) : input;
  const paths = new Set();

  for (const key of Object.keys(lockfile)) {
    if (key === '__metadata') continue;
    if (!key.includes('@workspace:')) continue;

    // Keys can have multiple comma-separated descriptors:
    // "@babel/types@workspace:*, @babel/types@workspace:^, @babel/types@workspace:packages/babel-types"
    const descriptors = key.split(', ');
    for (const desc of descriptors) {
      if (!desc.includes('@workspace:')) continue;

      const wsIndex = desc.indexOf('@workspace:');
      const path = desc.slice(wsIndex + '@workspace:'.length);

      // Skip wildcards (*, ^) and root workspace (.)
      if (path && path !== '.' && path !== '*' && path !== '^' && path.includes('/')) {
        paths.add(path);
      }
    }
  }

  return [...paths];
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
 * // => { 'packages/foo': { name: '@scope/foo', version: '1.0.0', dependencies: {...} } }
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
