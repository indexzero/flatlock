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
 * Extract package name from yarn classic key
 * Examples:
 *   "lodash@^4.17.21" → "lodash"
 *   "@babel/core@^7.0.0" → "@babel/core"
 *   "lodash@^4.17.21, lodash@^4.0.0" → "lodash" (multiple version ranges)
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name
 */
function extractName(key) {
  // Keys can have multiple version ranges: "pkg@^1.0.0, pkg@^2.0.0"
  // Take the first part before comma
  const firstKey = key.split(',')[0].trim();

  // For scoped packages like "@babel/core@^7.0.0"
  if (firstKey.startsWith('@')) {
    // Find the last @ which separates scope/name from version
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
 * @param {Object} [options] - Parser options
 * @returns {Generator<Dependency>}
 */
export function* fromYarnClassicLock(content, _options = {}) {
  const parsed = parse(content);

  if (parsed.type !== 'success') {
    throw new Error(`Failed to parse yarn.lock: ${parsed.type}`);
  }

  const lockfile = parsed.object;

  for (const [key, pkg] of Object.entries(lockfile)) {
    const name = extractName(key);
    const { version, integrity, resolved } = pkg;

    // Check if this is a link (file: or link: protocol)
    const link = resolved?.startsWith('file:') || resolved?.startsWith('link:');

    if (name && version) {
      const dep = { name, version };
      if (integrity) dep.integrity = integrity;
      if (resolved) dep.resolved = resolved;
      if (link) dep.link = true;
      yield dep;
    }
  }
}
