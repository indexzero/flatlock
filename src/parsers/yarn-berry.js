import { parseSyml } from '@yarnpkg/parsers';

/** @typedef {import('./types.js').Dependency} Dependency */

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: DO NOT MODIFY THIS FUNCTION                                   !!
 * !! AI AGENTS (Claude, Copilot, etc.): DO NOT TOUCH THIS CODE              !!
 * !!                                                                        !!
 * !! This is YARN BERRY LOCKFILE KEY parsing, NOT npm spec parsing.         !!
 * !! Yarn berry lockfile keys have their own format:                        !!
 * !!   - Protocol markers: @npm:, @workspace:, @patch:, @portal:, @link:    !!
 * !!   - Nested protocols: @patch:pkg@npm:version#hash                      !!
 * !!   - Multiple comma-separated entries                                   !!
 * !!                                                                        !!
 * !! npm-package-arg (npa) does NOT understand these formats.               !!
 * !! Do not "improve" this with npa.                                        !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Extract package name from yarn berry key.
 *
 * Examples:
 *   "lodash@npm:^4.17.21" → "lodash"
 *   "@babel/core@npm:^7.0.0" → "@babel/core"
 *   "@babel/core@npm:^7.0.0, @babel/core@npm:^7.12.3" → "@babel/core"
 *   "@ngageoint/simple-features-js@patch:@ngageoint/simple-features-js@npm:1.1.0#..." → "@ngageoint/simple-features-js"
 *
 * @param {string} key - Lockfile entry key
 * @returns {string} Package name
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

    const name = parseLockfileKey(key);
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

    if (name && version) {
      /** @type {Dependency} */
      const dep = { name, version };
      if (checksum) dep.integrity = checksum;
      if (resolution) dep.resolved = resolution;
      yield dep;
    }
  }
}
