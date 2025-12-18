/**
 * @fileoverview Parser for pnpm-lock.yaml v5.x format
 *
 * pnpm-lock.yaml v5.x format (2019-2022) characteristics:
 * - File: pnpm-lock.yaml
 * - Version field: lockfileVersion (number like 5, 5.1, 5.2, 5.3, 5.4)
 * - Package key format: /name/version or /@scope/name/version
 * - Peer dependency suffix: _peer@ver with + escaping for scoped packages
 *   Example: /foo/1.0.0_bar@2.0.0+@scope+qar@3.0.0
 *
 * Key differences from shrinkwrap v3/v4:
 * - Peer suffix uses _ instead of /
 * - Scoped peer packages escape @ with + instead of !
 *
 * @module flatlock/parsers/pnpm/v5
 */

/**
 * @typedef {Object} ParsedSpec
 * @property {string|null} name - The package name (null if unparseable)
 * @property {string|null} version - The package version (null if unparseable)
 */

/**
 * Parse a pnpm-lock.yaml v5.x package spec.
 *
 * v5 format uses:
 * - Slash separator between name and version: /name/version
 * - Peer dependencies after underscore: /name/version_peer@ver
 * - Scoped packages: /@scope/name/version
 * - Multiple peers joined with +: /name/1.0.0_peer1@2.0.0+peer2@3.0.0
 * - Scoped peer dependencies use + to escape the /: _@scope+pkg@1.0.0
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml packages section
 * @returns {ParsedSpec} Parsed name and version
 *
 * @example
 * // Unscoped package
 * parseSpecV5('/lodash/4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // Scoped package
 * parseSpecV5('/@babel/core/7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // With peer dependency suffix
 * parseSpecV5('/styled-jsx/3.0.9_react@17.0.2')
 * // => { name: 'styled-jsx', version: '3.0.9' }
 *
 * @example
 * // With multiple peer dependencies
 * parseSpecV5('/pkg/1.0.0_react-dom@17.0.2+react@17.0.2')
 * // => { name: 'pkg', version: '1.0.0' }
 *
 * @example
 * // Scoped package with peer deps
 * parseSpecV5('/@emotion/styled/10.0.27_react@17.0.2')
 * // => { name: '@emotion/styled', version: '10.0.27' }
 *
 * @example
 * // Prerelease version
 * parseSpecV5('/@verdaccio/ui-theme/6.0.0-6-next.50')
 * // => { name: '@verdaccio/ui-theme', version: '6.0.0-6-next.50' }
 *
 * @example
 * // Package with hyphenated name
 * parseSpecV5('/string-width/4.2.3')
 * // => { name: 'string-width', version: '4.2.3' }
 *
 * @example
 * // Scoped package with hyphenated name
 * parseSpecV5('/@babel/helper-compilation-targets/7.23.6')
 * // => { name: '@babel/helper-compilation-targets', version: '7.23.6' }
 *
 * @example
 * // Complex peer suffix with scoped peer
 * parseSpecV5('/styled-components/5.3.6_@babel+core@7.23.0+react@18.2.0')
 * // => { name: 'styled-components', version: '5.3.6' }
 *
 * @example
 * // link: protocol - skipped
 * parseSpecV5('link:packages/my-pkg')
 * // => { name: null, version: null }
 *
 * @example
 * // file: protocol - skipped
 * parseSpecV5('file:../local-package')
 * // => { name: null, version: null }
 *
 * @example
 * // Null input
 * parseSpecV5(null)
 * // => { name: null, version: null }
 *
 * @example
 * // Build metadata version
 * parseSpecV5('/esbuild/0.19.12+sha512.abc123')
 * // => { name: 'esbuild', version: '0.19.12+sha512.abc123' }
 */
export function parseSpecV5(spec) {
  // Handle null/undefined input
  if (spec == null || typeof spec !== 'string') {
    return { name: null, version: null };
  }

  // Skip special protocols
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { name: null, version: null };
  }

  // Remove leading slash if present
  let cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Handle empty string after removing slash
  if (!cleaned) {
    return { name: null, version: null };
  }

  // Strip peer dependency suffix FIRST (before splitting)
  // v5 format uses underscore: pkg/1.0.0_peer@2.0.0+other@1.0.0
  const underscoreIndex = cleaned.indexOf('_');
  if (underscoreIndex !== -1) {
    cleaned = cleaned.slice(0, underscoreIndex);
  }

  // Now split by slash to get name and version parts
  const parts = cleaned.split('/');

  // Determine if this is a scoped package
  if (cleaned.startsWith('@')) {
    // Scoped package: @scope/name/version
    // parts[0] = '@scope', parts[1] = 'name', parts[2] = 'version'

    if (parts.length < 3) {
      // Not enough parts for scoped package
      return { name: null, version: null };
    }

    const scope = parts[0]; // e.g., '@babel'
    const pkgName = parts[1]; // e.g., 'core'
    const version = parts[2]; // e.g., '7.23.0'

    // Validate scope format
    if (!scope.startsWith('@') || !scope.slice(1)) {
      return { name: null, version: null };
    }

    // Validate we have both name and version
    if (!pkgName || !version) {
      return { name: null, version: null };
    }

    return {
      name: `${scope}/${pkgName}`,
      version: version,
    };
  }

  // Unscoped package: name/version
  // parts[0] = 'name', parts[1] = 'version'

  if (parts.length < 2) {
    // Not enough parts
    return { name: null, version: null };
  }

  const name = parts[0];
  const version = parts[1];

  // Validate we have both name and version
  if (!name || !version) {
    return { name: null, version: null };
  }

  return { name, version };
}

/**
 * Check if a spec has peer dependency suffix (v5 format).
 *
 * In v5, peer dependencies are appended after the version
 * with an underscore: /name/version_peer@ver+peer2@ver
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml
 * @returns {boolean} True if the spec has peer dependency suffix
 *
 * @example
 * hasPeerSuffixV5('/lodash/4.17.21') // => false
 * hasPeerSuffixV5('/foo/1.0.0_bar@2.0.0') // => true
 * hasPeerSuffixV5('/@babel/core/7.23.0') // => false
 * hasPeerSuffixV5('/@emotion/styled/10.0.27_react@17.0.2') // => true
 */
export function hasPeerSuffixV5(spec) {
  if (spec == null || typeof spec !== 'string') {
    return false;
  }

  return spec.includes('_');
}

/**
 * Extract the peer dependency suffix from a v5 spec.
 *
 * @param {string} spec - Package spec from pnpm-lock.yaml v5
 * @returns {string|null} The peer suffix or null if none
 *
 * @example
 * extractPeerSuffixV5('/lodash/4.17.21') // => null
 * extractPeerSuffixV5('/foo/1.0.0_bar@2.0.0') // => 'bar@2.0.0'
 * extractPeerSuffixV5('/foo/1.0.0_bar@2.0.0+@scope+qar@3.0.0') // => 'bar@2.0.0+@scope+qar@3.0.0'
 */
export function extractPeerSuffixV5(spec) {
  if (spec == null || typeof spec !== 'string') {
    return null;
  }

  const underscoreIndex = spec.indexOf('_');
  if (underscoreIndex === -1) {
    return null;
  }

  return spec.slice(underscoreIndex + 1);
}
