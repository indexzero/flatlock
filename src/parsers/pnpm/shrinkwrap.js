/**
 * @fileoverview Parser for pnpm shrinkwrap.yaml (v3/v4) format
 *
 * Shrinkwrap format (2016-2019) characteristics:
 * - File: shrinkwrap.yaml
 * - Version field: shrinkwrapVersion (number, typically 3 or 4)
 * - Package key format: /name/version or /@scope/name/version
 * - Peer dependency suffix: /peer@ver with ! escaping for scoped packages
 *   Example: /foo/1.0.0/bar@2.0.0+@scope!qar@3.0.0
 *
 * @module flatlock/parsers/pnpm/shrinkwrap
 */

/**
 * @typedef {Object} ParsedSpec
 * @property {string|null} name - The package name (null if unparseable)
 * @property {string|null} version - The package version (null if unparseable)
 */

/**
 * Parse a shrinkwrap.yaml package spec (v3/v4 format).
 *
 * Shrinkwrap format uses:
 * - Slash separator between name and version: /name/version
 * - Peer dependencies after another slash: /name/version/peer@ver
 * - Scoped packages: /@scope/name/version
 * - Scoped peer dependencies use `!` to escape the `@`: `/name/1.0.0/peer@2.0.0+@scope!qar@3.0.0`
 *
 * @param {string} spec - Package spec from shrinkwrap.yaml packages section
 * @returns {ParsedSpec} Parsed name and version
 *
 * @example
 * // Unscoped package
 * parseSpecShrinkwrap('/lodash/4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // Scoped package
 * parseSpecShrinkwrap('/@babel/core/7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // With peer dependency suffix
 * parseSpecShrinkwrap('/foo/1.0.0/bar@2.0.0')
 * // => { name: 'foo', version: '1.0.0' }
 *
 * @example
 * // With scoped peer dependency (`!` escapes `@`)
 * parseSpecShrinkwrap('/foo/1.0.0/bar@2.0.0+@scope!qar@3.0.0')
 * // => { name: 'foo', version: '1.0.0' }
 *
 * @example
 * // Scoped package with peer deps
 * parseSpecShrinkwrap('/@emotion/styled/10.0.27/react@17.0.2')
 * // => { name: '@emotion/styled', version: '10.0.27' }
 *
 * @example
 * // Multiple peer dependencies
 * parseSpecShrinkwrap('/styled-components/5.3.6/react-dom@17.0.2+react@17.0.2')
 * // => { name: 'styled-components', version: '5.3.6' }
 *
 * @example
 * // Package with hyphenated name
 * parseSpecShrinkwrap('/string-width/4.2.3')
 * // => { name: 'string-width', version: '4.2.3' }
 *
 * @example
 * // Scoped package with hyphenated name
 * parseSpecShrinkwrap('/@babel/helper-compilation-targets/7.23.6')
 * // => { name: '@babel/helper-compilation-targets', version: '7.23.6' }
 *
 * @example
 * // link: protocol - skipped
 * parseSpecShrinkwrap('link:packages/my-pkg')
 * // => { name: null, version: null }
 *
 * @example
 * // file: protocol - skipped
 * parseSpecShrinkwrap('file:../local-package')
 * // => { name: null, version: null }
 *
 * @example
 * // Null input
 * parseSpecShrinkwrap(null)
 * // => { name: null, version: null }
 *
 * @example
 * // Empty string
 * parseSpecShrinkwrap('')
 * // => { name: null, version: null }
 */
export function parseSpecShrinkwrap(spec) {
  // Handle null/undefined input
  if (spec == null || typeof spec !== 'string') {
    return { name: null, version: null };
  }

  // Skip special protocols
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { name: null, version: null };
  }

  // Remove leading slash if present
  const cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Handle empty string after removing slash
  if (!cleaned) {
    return { name: null, version: null };
  }

  // Split by slash
  const parts = cleaned.split('/');

  // Determine if this is a scoped package
  // Scoped packages start with @ and have format: @scope/name/version[/peer-suffix]
  // Unscoped packages have format: name/version[/peer-suffix]

  if (cleaned.startsWith('@')) {
    // Scoped package: @scope/name/version[/peer-suffix]
    // parts[0] = '@scope', parts[1] = 'name', parts[2] = 'version', parts[3+] = peer suffix

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

    // The version might contain additional peer suffix parts that got split
    // In shrinkwrap v3/v4, peer suffixes come after another slash
    // But the version itself should be the semver string

    return {
      name: `${scope}/${pkgName}`,
      version: version
    };
  }

  // Unscoped package: name/version[/peer-suffix]
  // parts[0] = 'name', parts[1] = 'version', parts[2+] = peer suffix

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
 * Check if a spec has peer dependency suffix (shrinkwrap v3/v4 format).
 *
 * In shrinkwrap v3/v4, peer dependencies are appended after the version
 * with another slash: /name/version/peer@ver+peer2@ver
 *
 * @param {string} spec - Package spec from shrinkwrap.yaml
 * @returns {boolean} True if the spec has peer dependency suffix
 *
 * @example
 * hasPeerSuffix('/lodash/4.17.21') // => false
 * hasPeerSuffix('/foo/1.0.0/bar@2.0.0') // => true
 * hasPeerSuffix('/@babel/core/7.23.0') // => false
 * hasPeerSuffix('/@emotion/styled/10.0.27/react@17.0.2') // => true
 */
export function hasPeerSuffix(spec) {
  if (spec == null || typeof spec !== 'string') {
    return false;
  }

  // Remove leading slash
  const cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Count slashes
  const slashCount = (cleaned.match(/\//g) || []).length;

  // Scoped packages have 2+ slashes (scope/name/version), peer adds more
  // Unscoped packages have 1+ slash (name/version), peer adds more

  if (cleaned.startsWith('@')) {
    // Scoped: needs > 2 slashes for peer suffix
    return slashCount > 2;
  }

  // Unscoped: needs > 1 slash for peer suffix
  return slashCount > 1;
}

/**
 * Extract the peer dependency suffix from a shrinkwrap spec.
 *
 * @param {string} spec - Package spec from shrinkwrap.yaml
 * @returns {string|null} The peer suffix or null if none
 *
 * @example
 * extractPeerSuffix('/lodash/4.17.21') // => null
 * extractPeerSuffix('/foo/1.0.0/bar@2.0.0') // => 'bar@2.0.0'
 * extractPeerSuffix('/foo/1.0.0/bar@2.0.0+@scope!qar@3.0.0') // => 'bar@2.0.0+@scope!qar@3.0.0'
 */
export function extractPeerSuffix(spec) {
  if (spec == null || typeof spec !== 'string') {
    return null;
  }

  // Remove leading slash
  const cleaned = spec.startsWith('/') ? spec.slice(1) : spec;
  const parts = cleaned.split('/');

  if (cleaned.startsWith('@')) {
    // Scoped: @scope/name/version[/peer-suffix...]
    if (parts.length <= 3) {
      return null;
    }
    return parts.slice(3).join('/');
  }

  // Unscoped: name/version[/peer-suffix...]
  if (parts.length <= 2) {
    return null;
  }
  return parts.slice(2).join('/');
}
