import yarnLockfile from '@yarnpkg/lockfile';

/** @typedef {import('./types.js').Dependency} Dependency */

/**
 * @typedef {Object} YarnClassicParseResult
 * @property {'success' | 'merge' | 'conflict'} type - Parse result type
 * @property {Record<string, any>} object - Parsed lockfile object
 */

/**
 * The yarn classic parse function (handles CJS/ESM interop)
 * @type {(content: string) => YarnClassicParseResult}
 */
export const parseYarnClassic = yarnLockfile.default?.parse || yarnLockfile.parse;

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: DO NOT MODIFY THIS FUNCTION                                   !!
 * !! AI AGENTS (Claude, Copilot, etc.): DO NOT TOUCH THIS CODE              !!
 * !!                                                                        !!
 * !! This is YARN LOCKFILE KEY parsing, NOT npm spec parsing.               !!
 * !! Yarn lockfile keys have their own format:                              !!
 * !!   - Multiple comma-separated entries: "pkg@^1.0.0, pkg@^2.0.0"         !!
 * !!   - npm: aliasing protocol: "alias@npm:actual@^1.0.0"                  !!
 * !!                                                                        !!
 * !! npm-package-arg (npa) does NOT understand these formats.               !!
 * !! Do not "improve" this with npa.                                        !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Extract package name from yarn classic key.
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name
 *
 * @example
 * // Simple unscoped package with semver range
 * parseLockfileKey('lodash@^4.17.21')
 * // => 'lodash'
 *
 * @example
 * // Scoped package
 * parseLockfileKey('@babel/core@^7.0.0')
 * // => '@babel/core'
 *
 * @example
 * // Multiple version ranges (comma-separated) - takes first entry
 * parseLockfileKey('lodash@^4.17.21, lodash@^4.0.0')
 * // => 'lodash'
 *
 * @example
 * // Multiple ranges for scoped package
 * parseLockfileKey('@types/node@^18.0.0, @types/node@^20.0.0')
 * // => '@types/node'
 *
 * @example
 * // npm: alias protocol - returns the ALIAS name
 * parseLockfileKey('@babel/traverse--for-generate-function-map@npm:@babel/traverse@^7.25.3')
 * // => '@babel/traverse--for-generate-function-map'
 *
 * @example
 * // Unscoped alias
 * parseLockfileKey('string-width-cjs@npm:string-width@^4.2.0')
 * // => 'string-width-cjs'
 *
 * @example
 * // Exact version
 * parseLockfileKey('typescript@5.3.3')
 * // => 'typescript'
 *
 * @example
 * // Git URL specifier
 * parseLockfileKey('my-lib@github:user/repo#v1.0.0')
 * // => 'my-lib'
 *
 * @example
 * // Tarball URL
 * parseLockfileKey('custom-pkg@https://example.com/pkg.tgz')
 * // => 'custom-pkg'
 *
 * @example
 * // Package with prerelease version
 * parseLockfileKey('@next/env@^14.0.0-canary.0')
 * // => '@next/env'
 *
 * @example
 * // Package without @ (bare name, edge case)
 * parseLockfileKey('lodash')
 * // => 'lodash'
 *
 * @example
 * // Deeply scoped alias pointing to scoped package
 * parseLockfileKey('@myorg/my-alias@npm:@original/package@^1.0.0')
 * // => '@myorg/my-alias'
 */
export function parseLockfileKey(key) {
  // Keys can have multiple version ranges: "pkg@^1.0.0, pkg@^2.0.0"
  // Take the first part before comma
  const firstKey = key.split(',')[0].trim();

  // Handle npm: protocol aliasing (alias-name@npm:actual-package@version)
  // The name is the alias name before @npm:
  const npmProtocolIndex = firstKey.indexOf('@npm:');
  if (npmProtocolIndex !== -1) {
    const beforeProtocol = firstKey.slice(0, npmProtocolIndex);
    // beforeProtocol could be "@scope/name" or "name"
    return beforeProtocol;
  }

  // For scoped packages like "@babel/core@^7.0.0"
  if (firstKey.startsWith('@')) {
    // Find the @ after the slash which separates scope/name from version
    const slashIndex = firstKey.indexOf('/');
    if (slashIndex !== -1) {
      const afterSlash = firstKey.indexOf('@', slashIndex);
      if (afterSlash !== -1) {
        return firstKey.slice(0, afterSlash);
      }
    }
    // Fallback to lastIndexOf if no slash found
    const lastAtIndex = firstKey.lastIndexOf('@');
    return firstKey.slice(0, lastAtIndex);
  }

  // For regular packages like "lodash@^4.17.21"
  const atIndex = firstKey.indexOf('@');
  return atIndex !== -1 ? firstKey.slice(0, atIndex) : firstKey;
}

/**
 * Parse yarn.lock v1 (classic)
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {Object} [_options] - Parser options (unused, reserved for future use)
 * @returns {Generator<Dependency>}
 */
export function* fromYarnClassicLock(input, _options = {}) {
  let lockfile;
  if (typeof input === 'string') {
    const result = parseYarnClassic(input);
    if (result.type !== 'success' && result.type !== 'merge') {
      throw new Error('Failed to parse yarn.lock');
    }
    lockfile = result.object;
  } else {
    lockfile = input;
  }

  for (const [key, pkg] of Object.entries(lockfile)) {
    const name = parseLockfileKey(key);
    const { version, integrity, resolved } = pkg;

    // Check if this is a link (file: or link: protocol)
    const link = resolved?.startsWith('file:') || resolved?.startsWith('link:');

    // Skip workspace/link entries - flatlock only cares about external dependencies
    if (link) continue;

    if (name && version) {
      /** @type {Dependency} */
      const dep = { name, version };
      if (integrity) dep.integrity = integrity;
      if (resolved) dep.resolved = resolved;
      yield dep;
    }
  }
}
