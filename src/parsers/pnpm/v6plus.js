/**
 * @fileoverview Parser for pnpm-lock.yaml v6+ format (v6.0 and v9.0)
 *
 * pnpm-lock.yaml v6+ format (2023+) characteristics:
 * - File: pnpm-lock.yaml
 * - Version field: lockfileVersion (string like '6.0', '9.0')
 * - Package key format:
 *   - v6: /name@version or /@scope/name@version (with leading slash)
 *   - v9: name@version or @scope/name@version (no leading slash)
 * - Peer dependency suffix: (peer@ver) in parentheses
 *   Example: /@babel/core@7.23.0(@types/node@20.0.0)
 *
 * Key differences from v5:
 * - Uses @ separator between name and version instead of /
 * - Peer suffix uses parentheses () instead of underscore _
 * - Peer names are human-readable (no hashing)
 * - v9 additionally removes leading slash from keys
 *
 * @module flatlock/parsers/pnpm/v6plus
 */

/**
 * @typedef {Object} ParsedSpec
 * @property {string|null} name - The package name (null if unparseable)
 * @property {string|null} version - The package version (null if unparseable)
 */

/**
 * Parse a pnpm-lock.yaml v6+ package spec.
 *
 * v6/v9 format uses:
 * - @ separator between name and version: name@version
 * - Leading slash in v6: /name@version, no slash in v9: name@version
 * - Peer dependencies in parentheses: name@version(peer@ver)
 * - Scoped packages: @scope/name@version
 * - Multiple peers: name@version(peer1@ver)(peer2@ver)
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml packages section
 * @returns {ParsedSpec} Parsed name and version
 *
 * @example
 * // Unscoped package (v6 format with leading slash)
 * parseSpecV6Plus('/lodash@4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // Unscoped package (v9 format without leading slash)
 * parseSpecV6Plus('lodash@4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // Scoped package (v6)
 * parseSpecV6Plus('/@babel/core@7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // Scoped package (v9)
 * parseSpecV6Plus('@babel/core@7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // With peer dependency suffix
 * parseSpecV6Plus('/@babel/core@7.23.0(@types/node@20.0.0)')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // With multiple peer dependencies
 * parseSpecV6Plus('/@aleph-alpha/config-css@0.18.4(@unocss/core@66.5.2)(postcss@8.5.6)')
 * // => { name: '@aleph-alpha/config-css', version: '0.18.4' }
 *
 * @example
 * // Prerelease version
 * parseSpecV6Plus('/unusual-pkg@1.0.0-beta.1')
 * // => { name: 'unusual-pkg', version: '1.0.0-beta.1' }
 */
export function parseSpecV6Plus(spec) {
  // Handle null/undefined input
  if (spec == null || typeof spec !== 'string') {
    return { name: null, version: null };
  }

  // Skip special protocols
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { name: null, version: null };
  }

  // Remove leading slash if present (v6 has it, v9 doesn't)
  let cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Handle empty string
  if (!cleaned) {
    return { name: null, version: null };
  }

  // Strip peer dependency suffixes FIRST (before looking for @ separator)
  // v6+/v9 format uses parentheses: "@babel/core@7.23.0(@types/node@20.0.0)"
  const parenIndex = cleaned.indexOf('(');
  if (parenIndex !== -1) {
    cleaned = cleaned.slice(0, parenIndex);
  }

  // Find the last @ which separates name from version
  // For scoped packages like "@babel/core@7.23.0", we need the last @
  const lastAtIndex = cleaned.lastIndexOf('@');

  // If we found an @ that's not at position 0, use v6+ parsing
  if (lastAtIndex > 0) {
    const name = cleaned.slice(0, lastAtIndex);
    const version = cleaned.slice(lastAtIndex + 1);

    // Validate we have both name and version
    if (!name || !version) {
      return { name: null, version: null };
    }

    return { name, version };
  }

  // No valid @ separator found (or @ is at position 0 meaning just a scope)
  return { name: null, version: null };
}

/**
 * Check if a spec has peer dependency suffix (v6+ format).
 *
 * In v6+, peer dependencies are in parentheses: name@version(peer@ver)
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml
 * @returns {boolean} True if the spec has peer dependency suffix
 *
 * @example
 * hasPeerSuffixV6Plus('/lodash@4.17.21') // => false
 * hasPeerSuffixV6Plus('/@babel/core@7.23.0(@types/node@20.0.0)') // => true
 * hasPeerSuffixV6Plus('lodash@4.17.21') // => false
 * hasPeerSuffixV6Plus('@emotion/styled@10.0.27(react@17.0.2)') // => true
 */
export function hasPeerSuffixV6Plus(spec) {
  if (spec == null || typeof spec !== 'string') {
    return false;
  }

  return spec.includes('(') && spec.includes(')');
}

/**
 * Extract the peer dependency suffix from a v6+ spec.
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml v6+
 * @returns {string|null} The peer suffix (including parentheses) or null if none
 *
 * @example
 * extractPeerSuffixV6Plus('/lodash@4.17.21') // => null
 * extractPeerSuffixV6Plus('/@babel/core@7.23.0(@types/node@20.0.0)') // => '(@types/node@20.0.0)'
 * extractPeerSuffixV6Plus('/@pkg@1.0.0(peer1@2.0.0)(peer2@3.0.0)') // => '(peer1@2.0.0)(peer2@3.0.0)'
 */
export function extractPeerSuffixV6Plus(spec) {
  if (spec == null || typeof spec !== 'string') {
    return null;
  }

  const parenIndex = spec.indexOf('(');
  if (parenIndex === -1) {
    return null;
  }

  return spec.slice(parenIndex);
}

/**
 * Parse peer dependencies from a v6+ peer suffix.
 *
 * @param {string} peerSuffix - The peer suffix like '(peer1@1.0.0)(peer2@2.0.0)'
 * @returns {Array<{name: string, version: string}>} Array of parsed peer dependencies
 *
 * @example
 * parsePeerDependencies('(@types/node@20.0.0)')
 * // => [{ name: '@types/node', version: '20.0.0' }]
 *
 * @example
 * parsePeerDependencies('(react@18.2.0)(typescript@5.3.3)')
 * // => [{ name: 'react', version: '18.2.0' }, { name: 'typescript', version: '5.3.3' }]
 */
export function parsePeerDependencies(peerSuffix) {
  if (peerSuffix == null || typeof peerSuffix !== 'string') {
    return [];
  }

  const peers = [];

  // Match each (name@version) group
  const regex = /\(([^)]+)\)/g;
  let match;

  while ((match = regex.exec(peerSuffix)) !== null) {
    const peerSpec = match[1];
    const lastAtIndex = peerSpec.lastIndexOf('@');

    if (lastAtIndex > 0) {
      const name = peerSpec.slice(0, lastAtIndex);
      const version = peerSpec.slice(lastAtIndex + 1);

      if (name && version) {
        peers.push({ name, version });
      }
    }
  }

  return peers;
}
