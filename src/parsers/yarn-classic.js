import yarnLockfile from '@yarnpkg/lockfile';

const { parse } = yarnLockfile;

/**
 * @typedef {Object} Dependency
 * @property {string} name - Package name
 * @property {string} version - Resolved version
 * @property {string} [integrity] - Integrity hash
 * @property {string} [resolved] - Resolution URL
 * @property {boolean} [link] - True if this is a symlink
 */

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
 * Examples:
 *   "lodash@^4.17.21" → "lodash"
 *   "@babel/core@^7.0.0" → "@babel/core"
 *   "lodash@^4.17.21, lodash@^4.0.0" → "lodash" (multiple version ranges)
 *   "@babel/traverse--for-generate-function-map@npm:@babel/traverse@^7.25.3" → "@babel/traverse--for-generate-function-map"
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name
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
 * @param {string} content - Lockfile content
 * @param {Object} [_options] - Parser options (unused, reserved for future use)
 * @returns {Generator<Dependency>}
 */
export function* fromYarnClassicLock(content, _options = {}) {
  const parsed = parse(content);

  if (parsed.type !== 'success') {
    throw new Error(`Failed to parse yarn.lock: ${parsed.type}`);
  }

  const lockfile = parsed.object;

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
