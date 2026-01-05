/**
 * @fileoverview Version detection for pnpm lockfiles
 *
 * Detects the era and version of pnpm lockfiles including:
 * - shrinkwrap.yaml (v3/v4) from 2016-2019
 * - pnpm-lock.yaml v5.x (2019-2022)
 * - pnpm-lock.yaml v6.0 (2023)
 * - pnpm-lock.yaml v9.0 (2024+)
 *
 * @module flatlock/parsers/pnpm/detect
 */

/**
 * @typedef {'shrinkwrap'|'v5'|'v5-inline'|'v6'|'v9'|'unknown'} LockfileEra
 */

/**
 * @typedef {Object} DetectedVersion
 * @property {LockfileEra} era - The lockfile era/format family
 * @property {string|number} version - The raw version from the lockfile
 * @property {boolean} isShrinkwrap - True if this is a shrinkwrap.yaml file
 */

/**
 * Detect the version and era of a pnpm lockfile.
 *
 * Version detection rules:
 * - If `shrinkwrapVersion` exists: shrinkwrap era (v3/v4)
 * - If `lockfileVersion` is a number: v5 era
 * - If `lockfileVersion` is '5.4-inlineSpecifiers': v5-inline era
 * - If `lockfileVersion` starts with '6': v6 era
 * - If `lockfileVersion` starts with '9': v9 era
 *
 * @param {Object} lockfile - Parsed pnpm lockfile object
 * @param {string|number} [lockfile.lockfileVersion] - The lockfile version field
 * @param {number} [lockfile.shrinkwrapVersion] - The shrinkwrap version field (v3/v4)
 * @param {number} [lockfile.shrinkwrapMinorVersion] - Minor version for shrinkwrap
 * @returns {DetectedVersion} The detected version information
 *
 * @example
 * // shrinkwrap.yaml v3
 * detectVersion({ shrinkwrapVersion: 3 })
 * // => { era: 'shrinkwrap', version: 3, isShrinkwrap: true }
 *
 * @example
 * // pnpm-lock.yaml v5.4
 * detectVersion({ lockfileVersion: 5.4 })
 * // => { era: 'v5', version: 5.4, isShrinkwrap: false }
 *
 * @example
 * // pnpm-lock.yaml v6.0
 * detectVersion({ lockfileVersion: '6.0' })
 * // => { era: 'v6', version: '6.0', isShrinkwrap: false }
 *
 * @example
 * // pnpm-lock.yaml v9.0
 * detectVersion({ lockfileVersion: '9.0' })
 * // => { era: 'v9', version: '9.0', isShrinkwrap: false }
 */
export function detectVersion(lockfile) {
  // Handle null/undefined input
  if (!lockfile || typeof lockfile !== 'object') {
    return { era: 'unknown', version: '', isShrinkwrap: false };
  }

  // Check for shrinkwrap.yaml (v3/v4) - oldest format
  if ('shrinkwrapVersion' in lockfile) {
    const version = lockfile.shrinkwrapVersion;
    return {
      era: 'shrinkwrap',
      version: version,
      isShrinkwrap: true
    };
  }

  // Get the lockfileVersion
  const version = lockfile.lockfileVersion;

  // Handle missing version
  if (version === undefined || version === null) {
    return { era: 'unknown', version: '', isShrinkwrap: false };
  }

  // Numeric version: v5.x era
  if (typeof version === 'number') {
    return {
      era: 'v5',
      version: version,
      isShrinkwrap: false
    };
  }

  // String version
  if (typeof version === 'string') {
    // v5.4-inlineSpecifiers: experimental transitional format
    if (version.includes('inlineSpecifiers')) {
      return {
        era: 'v5-inline',
        version: version,
        isShrinkwrap: false
      };
    }

    // v9.x era (2024+)
    if (version.startsWith('9')) {
      return {
        era: 'v9',
        version: version,
        isShrinkwrap: false
      };
    }

    // v6.x era (2023)
    if (version.startsWith('6')) {
      return {
        era: 'v6',
        version: version,
        isShrinkwrap: false
      };
    }

    // v7.x or v8.x would fall here if they existed (they don't)
    // Could be a future version we don't know about
  }

  return { era: 'unknown', version: version, isShrinkwrap: false };
}

/**
 * Check if a lockfile uses the v6+ package key format (name@version).
 *
 * v5 and earlier use: /name/version or /@scope/name/version
 * v6+ use: /name@version or /@scope/name@version
 * v9+ use: name@version (no leading slash)
 *
 * @param {DetectedVersion} detected - The detected version info
 * @returns {boolean} True if the lockfile uses @ separator for name@version
 *
 * @example
 * usesAtSeparator({ era: 'v5', version: 5.4 }) // => false
 * usesAtSeparator({ era: 'v6', version: '6.0' }) // => true
 * usesAtSeparator({ era: 'v9', version: '9.0' }) // => true
 */
export function usesAtSeparator(detected) {
  return detected.era === 'v6' || detected.era === 'v9';
}

/**
 * Check if a lockfile uses the packages/snapshots split (v9+).
 *
 * v9 separates package metadata (packages) from dependency relationships (snapshots).
 *
 * @param {DetectedVersion} detected - The detected version info
 * @returns {boolean} True if the lockfile has packages/snapshots split
 *
 * @example
 * usesSnapshotsSplit({ era: 'v6', version: '6.0' }) // => false
 * usesSnapshotsSplit({ era: 'v9', version: '9.0' }) // => true
 */
export function usesSnapshotsSplit(detected) {
  return detected.era === 'v9';
}

/**
 * Check if a lockfile uses inline specifiers.
 *
 * v5.4-inlineSpecifiers and v6+ use inline specifiers in importers.
 * Earlier versions have a separate `specifiers` block.
 *
 * @param {DetectedVersion} detected - The detected version info
 * @returns {boolean} True if specifiers are inlined
 *
 * @example
 * usesInlineSpecifiers({ era: 'v5', version: 5.4 }) // => false
 * usesInlineSpecifiers({ era: 'v5-inline', version: '5.4-inlineSpecifiers' }) // => true
 * usesInlineSpecifiers({ era: 'v6', version: '6.0' }) // => true
 */
export function usesInlineSpecifiers(detected) {
  return detected.era === 'v5-inline' || detected.era === 'v6' || detected.era === 'v9';
}

/**
 * Check if package keys have a leading slash.
 *
 * v5 and v6 use leading slash: /name/version or /name@version
 * v9 omits leading slash: name@version
 *
 * @param {DetectedVersion} detected - The detected version info
 * @returns {boolean} True if package keys have leading slash
 *
 * @example
 * hasLeadingSlash({ era: 'v5', version: 5.4 }) // => true
 * hasLeadingSlash({ era: 'v6', version: '6.0' }) // => true
 * hasLeadingSlash({ era: 'v9', version: '9.0' }) // => false
 */
export function hasLeadingSlash(detected) {
  return detected.era !== 'v9';
}
