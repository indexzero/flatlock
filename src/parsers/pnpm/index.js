/**
 * @fileoverview pnpm lockfile parser supporting all documented versions
 *
 * Supported formats:
 * - shrinkwrap.yaml v3/v4 (2016-2019): shrinkwrapVersion field
 * - pnpm-lock.yaml v5.x (2019-2022): lockfileVersion number
 * - pnpm-lock.yaml v5.4-inlineSpecifiers (experimental): lockfileVersion string
 * - pnpm-lock.yaml v6.0 (2023): lockfileVersion '6.0'
 * - pnpm-lock.yaml v9.0 (2024+): lockfileVersion '9.0'
 *
 * @module flatlock/parsers/pnpm
 */

import yaml from 'js-yaml';

import { detectVersion, usesAtSeparator, usesSnapshotsSplit, usesInlineSpecifiers, hasLeadingSlash } from './detect.js';
import { parseSpecShrinkwrap } from './shrinkwrap.js';
import { parseSpecV5 } from './v5.js';
import { parseSpecV6Plus } from './v6plus.js';

/** @typedef {import('../types.js').Dependency} Dependency */

// Re-export detection utilities
export { detectVersion, usesAtSeparator, usesSnapshotsSplit, usesInlineSpecifiers, hasLeadingSlash } from './detect.js';

// Re-export version-specific parsers
export { parseSpecShrinkwrap, hasPeerSuffix, extractPeerSuffix } from './shrinkwrap.js';
export { parseSpecV5, hasPeerSuffixV5, extractPeerSuffixV5 } from './v5.js';
export { parseSpecV6Plus, hasPeerSuffixV6Plus, extractPeerSuffixV6Plus, parsePeerDependencies } from './v6plus.js';

/**
 * Parse pnpm package spec to extract name and version.
 *
 * This is the unified parser that auto-detects the format based on the spec pattern.
 * It supports all pnpm lockfile versions without requiring version context.
 *
 * Detection heuristics:
 * 1. If spec contains '(' -> v6+ format (peer deps in parentheses)
 * 2. If spec contains '@' after position 0 and no '/' after the '@' -> v6+ format
 * 3. Otherwise -> v5 or earlier format (slash separator)
 *
 * Supports multiple pnpm lockfile versions:
 *   shrinkwrap v3/v4 format (slash separator, peer suffix with /):
 *     "/lodash/4.17.21" -> { name: "lodash", version: "4.17.21" }
 *     "/foo/1.0.0/bar@2.0.0" -> { name: "foo", version: "1.0.0" }
 *
 *   v5.x format (slash separator, peer suffix with _):
 *     "/@babel/core/7.23.0" -> { name: "@babel/core", version: "7.23.0" }
 *     "/pkg/1.0.0_peer@2.0.0" -> { name: "pkg", version: "1.0.0" }
 *
 *   v6+ format (@ separator):
 *     "/@babel/core@7.23.0" -> { name: "@babel/core", version: "7.23.0" }
 *     "/lodash@4.17.21" -> { name: "lodash", version: "4.17.21" }
 *
 *   v9+ format (no leading slash, peer suffix in parens):
 *     "@babel/core@7.23.0(@types/node@20.0.0)" -> { name: "@babel/core", version: "7.23.0" }
 *
 *   Special protocols (skipped):
 *     "link:packages/foo" -> { name: null, version: null }
 *     "file:../local-pkg" -> { name: null, version: null }
 *
 * @param {string} spec - Package spec from pnpm lockfile
 * @returns {{ name: string | null, version: string | null }}
 *
 * @example
 * // v5 format
 * parseSpec('/lodash/4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // v6 format
 * parseSpec('/@babel/core@7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // v9 format
 * parseSpec('@babel/core@7.23.0(@types/node@20.0.0)')
 * // => { name: '@babel/core', version: '7.23.0' }
 */
export function parseSpec(spec) {
  // Handle null/undefined input
  if (spec == null || typeof spec !== 'string') {
    return { name: null, version: null };
  }

  // Skip special protocols
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { name: null, version: null };
  }

  // Detect format based on spec pattern
  // v6+ uses parentheses for peer deps and @ separator
  // v5 and earlier use _ for peer deps and / separator

  // Check for v6+ parentheses peer suffix
  if (spec.includes('(')) {
    return parseSpecV6Plus(spec);
  }

  // Remove leading slash for analysis
  const cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Check for v6+ @ separator format
  // In v6+, the format is name@version where @ separates name from version
  // We need to find @ that isn't at position 0 (which would be a scope)
  // And check that it's not part of a v5 peer suffix (which comes after _)

  // First strip any v5 peer suffix for cleaner analysis
  const withoutV5Peer = cleaned.split('_')[0];

  // Find the last @ in the cleaned string
  const lastAtIndex = withoutV5Peer.lastIndexOf('@');

  if (lastAtIndex > 0) {
    // Check if this is v6+ format by seeing if there's a / after the @
    // In v6+: @babel/core@7.23.0 - the last @ separates name@version
    // In v5: @babel/core/7.23.0 - no @ after the scope

    const afterAt = withoutV5Peer.slice(lastAtIndex + 1);

    // If there's no / in the part after the last @, it's likely v6+ format
    // (the part after @ is just the version like "7.23.0")
    if (!afterAt.includes('/')) {
      return parseSpecV6Plus(spec);
    }
  }

  // Fall back to v5 format (also handles shrinkwrap v3/v4 for basic cases)
  // Note: shrinkwrap v3/v4 peer suffix with / is handled differently,
  // but parseSpecV5 will still extract the correct name/version
  // because it stops at _ (v5) and the shrinkwrap / peer suffix
  // comes after the version anyway

  return parseSpecV5(spec);
}

/**
 * Extract package name from pnpm lockfile key.
 * Wraps parseSpec to return just the name (consistent with other parsers).
 *
 * @param {string} key - pnpm lockfile key
 * @returns {string | null} Package name
 *
 * @example
 * parseLockfileKey('/@babel/core@7.23.0') // => '@babel/core'
 * parseLockfileKey('/lodash/4.17.21') // => 'lodash'
 */
export function parseLockfileKey(key) {
  return parseSpec(key).name;
}

/**
 * Parse pnpm lockfile (shrinkwrap.yaml, pnpm-lock.yaml v5.x, v6, v9)
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {Object} [_options] - Parser options (unused, reserved for future use)
 * @returns {Generator<Dependency>}
 *
 * @example
 * // Parse from string
 * const deps = [...fromPnpmLock(yamlContent)];
 *
 * @example
 * // Parse from pre-parsed object
 * const lockfile = yaml.load(content);
 * const deps = [...fromPnpmLock(lockfile)];
 */
export function* fromPnpmLock(input, _options = {}) {
  const lockfile = /** @type {Record<string, any>} */ (
    typeof input === 'string' ? yaml.load(input) : input
  );

  // Detect version to determine where to look for packages
  const detected = detectVersion(lockfile);

  // Get packages object - location varies by version
  // v5, v6: packages section directly
  // v9: packages section has metadata, snapshots has relationships
  // For dependency extraction, we primarily need packages (for resolution info)
  const packages = lockfile.packages || {};

  // For v9, we should also look at snapshots for additional entries
  // that might only be in snapshots (peer variants)
  const snapshots = lockfile.snapshots || {};

  // Track seen packages to avoid duplicates (v9 has same package in both sections)
  const seen = new Set();

  // Process packages section
  for (const [spec, pkg] of Object.entries(packages)) {
    // Skip if we couldn't parse name/version
    const { name, version } = parseSpec(spec);
    if (!name || !version) continue;

    // Create dedup key
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resolution = pkg.resolution || {};
    const integrity = resolution.integrity;
    const resolved = resolution.tarball;
    const link = spec.startsWith('link:') || resolution.type === 'directory';

    // Skip workspace/link entries - flatlock only cares about external dependencies
    if (link) continue;

    /** @type {Dependency} */
    const dep = { name, version };
    if (integrity) dep.integrity = integrity;
    if (resolved) dep.resolved = resolved;
    yield dep;
  }

  // For v9, also process snapshots for peer variants
  // (they might have different resolution info)
  if (detected.era === 'v9') {
    for (const [spec, _snapshot] of Object.entries(snapshots)) {
      const { name, version } = parseSpec(spec);
      if (!name || !version) continue;

      // Create dedup key
      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Snapshots don't have resolution info, check if base package exists
      // The base package key in v9 is just name@version (without peer suffix)
      const baseKey = `${name}@${version}`;
      const basePkg = packages[baseKey];

      if (basePkg) {
        const resolution = basePkg.resolution || {};
        const integrity = resolution.integrity;
        const resolved = resolution.tarball;

        /** @type {Dependency} */
        const dep = { name, version };
        if (integrity) dep.integrity = integrity;
        if (resolved) dep.resolved = resolved;
        yield dep;
      }
    }
  }

  // Note: importers (workspace packages) are intentionally NOT yielded
  // flatlock only cares about external dependencies
}
