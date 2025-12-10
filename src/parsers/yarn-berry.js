import { parseSyml } from '@yarnpkg/parsers';

/**
 * @typedef {Object} Dependency
 * @property {string} name - Package name
 * @property {string} version - Resolved version
 * @property {string} [integrity] - Integrity hash
 * @property {string} [resolved] - Resolution URL
 * @property {boolean} [link] - True if this is a symlink
 */

/**
 * Extract package name from yarn berry key
 * Examples:
 *   "lodash@npm:^4.17.21" → "lodash"
 *   "@babel/core@npm:^7.0.0" → "@babel/core"
 *   "@babel/core@npm:^7.0.0, @babel/core@npm:^7.12.3" → "@babel/core"
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name
 */
function extractName(key) {
  // Keys can have multiple comma-separated entries, take the first one
  const firstKey = key.split(',')[0].trim();

  // Find the @npm:, @workspace:, @portal:, etc. protocol marker
  const protocolIndex = firstKey.indexOf('@npm:');
  if (protocolIndex !== -1) {
    return firstKey.slice(0, protocolIndex);
  }

  const workspaceIndex = firstKey.indexOf('@workspace:');
  if (workspaceIndex !== -1) {
    return firstKey.slice(0, workspaceIndex);
  }

  const portalIndex = firstKey.indexOf('@portal:');
  if (portalIndex !== -1) {
    return firstKey.slice(0, portalIndex);
  }

  const linkIndex = firstKey.indexOf('@link:');
  if (linkIndex !== -1) {
    return firstKey.slice(0, linkIndex);
  }

  const patchIndex = firstKey.indexOf('@patch:');
  if (patchIndex !== -1) {
    return firstKey.slice(0, patchIndex);
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
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Parser options
 * @returns {Generator<Dependency>}
 */
export function* fromYarnBerryLock(content, _options = {}) {
  const lockfile = parseSyml(content);

  for (const [key, pkg] of Object.entries(lockfile)) {
    // Skip metadata
    if (key === '__metadata') continue;

    const name = extractName(key);
    const { version, checksum, resolution } = pkg;

    // Check if this is a link (workspace:, portal:, or link: protocol)
    const link = resolution?.startsWith('workspace:')
      || resolution?.startsWith('portal:')
      || resolution?.startsWith('link:');

    if (name && version) {
      const dep = { name, version };
      if (checksum) dep.integrity = checksum;
      // Only include resolved for non-link packages
      if (resolution && !link) dep.resolved = resolution;
      if (link) dep.link = true;
      yield dep;
    }
  }
}
