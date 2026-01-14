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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { detectVersion } from './detect.js';
import { parseSpecShrinkwrap } from './shrinkwrap.js';
import { parseSpecV5 } from './v5.js';
import { parseSpecV6Plus } from './v6plus.js';

/** @typedef {import('../types.js').Dependency} Dependency */

/**
 * @typedef {Object} WorkspacePackage
 * @property {string} name
 * @property {string} version
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {Record<string, string>} [peerDependencies]
 */

// Public API: detectVersion for users who need to inspect lockfile version
export { detectVersion } from './detect.js';

// Version-specific internals available via 'flatlock/parsers/pnpm/internal'

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
 * @param {string} spec - Package spec from pnpm lockfile
 * @returns {{ name: string | null, version: string | null }}
 *
 * @example
 * // v5 format - unscoped package
 * parseSpec('/lodash/4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // v5 format - scoped package
 * parseSpec('/@babel/core/7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // v5 format - with peer dependency suffix (underscore)
 * parseSpec('/styled-jsx/3.0.9_react@17.0.2')
 * // => { name: 'styled-jsx', version: '3.0.9' }
 *
 * @example
 * // v6 format - unscoped package (with leading slash)
 * parseSpec('/lodash@4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // v6 format - scoped package
 * parseSpec('/@babel/core@7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // v9 format - unscoped package (no leading slash)
 * parseSpec('lodash@4.17.21')
 * // => { name: 'lodash', version: '4.17.21' }
 *
 * @example
 * // v9 format - scoped package (no leading slash)
 * parseSpec('@babel/core@7.23.0')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // v9 format - with peer dependency suffix (parentheses)
 * parseSpec('@babel/core@7.23.0(@types/node@20.0.0)')
 * // => { name: '@babel/core', version: '7.23.0' }
 *
 * @example
 * // v9 format - multiple peer dependencies
 * parseSpec('@testing-library/react@14.0.0(react-dom@18.2.0)(react@18.2.0)')
 * // => { name: '@testing-library/react', version: '14.0.0' }
 *
 * @example
 * // Shrinkwrap v3/v4 format - with peer suffix (slash)
 * parseSpec('/foo/1.0.0/bar@2.0.0')
 * // => { name: 'foo', version: '1.0.0' }
 *
 * @example
 * // link: protocol - skipped (returns null)
 * parseSpec('link:packages/my-pkg')
 * // => { name: null, version: null }
 *
 * @example
 * // file: protocol - skipped (returns null)
 * parseSpec('file:../local-package')
 * // => { name: null, version: null }
 *
 * @example
 * // Null input
 * parseSpec(null)
 * // => { name: null, version: null }
 *
 * @example
 * // Prerelease version
 * parseSpec('@verdaccio/ui-theme@6.0.0-6-next.50')
 * // => { name: '@verdaccio/ui-theme', version: '6.0.0-6-next.50' }
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

  // Select era-specific parser
  // Each era has different peer suffix formats that parseSpec can't auto-detect
  const parseSpecForEra =
    detected.era === 'shrinkwrap'
      ? parseSpecShrinkwrap
      : detected.era === 'v5'
        ? parseSpecV5
        : parseSpecV6Plus;

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
    const { name, version } = parseSpecForEra(spec);
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
      const { name, version } = parseSpecForEra(spec);
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

/**
 * Extract workspace paths from pnpm lockfile.
 *
 * pnpm stores workspace packages in the `importers` section.
 * Each key is a workspace path relative to the repo root.
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @returns {string[]} Array of workspace paths (e.g., ['packages/foo', 'packages/bar'])
 *
 * @example
 * extractWorkspacePaths(lockfile)
 * // => ['packages/vue', 'packages/compiler-core', ...]
 */
export function extractWorkspacePaths(input) {
  const lockfile = /** @type {Record<string, any>} */ (
    typeof input === 'string' ? yaml.load(input) : input
  );

  const importers = lockfile.importers || {};
  return Object.keys(importers).filter(k => k !== '.');
}

/**
 * Build workspace packages map by reading package.json files.
 *
 * @param {string | object} input - Lockfile content string or pre-parsed object
 * @param {string} repoDir - Path to repository root
 * @returns {Promise<Record<string, WorkspacePackage>>} Map of workspace path to package info
 *
 * @example
 * const workspaces = await buildWorkspacePackages(lockfile, '/path/to/repo');
 * // => { 'packages/foo': { name: '@scope/foo', version: '1.0.0', dependencies: {...} } }
 */
export async function buildWorkspacePackages(input, repoDir) {
  const paths = extractWorkspacePaths(input);
  /** @type {Record<string, WorkspacePackage>} */
  const workspacePackages = {};

  for (const wsPath of paths) {
    const pkgJsonPath = join(repoDir, wsPath, 'package.json');
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
      workspacePackages[wsPath] = {
        name: pkg.name,
        version: pkg.version || '0.0.0',
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        optionalDependencies: pkg.optionalDependencies,
        peerDependencies: pkg.peerDependencies
      };
    } catch {
      // Skip workspaces with missing or invalid package.json
    }
  }

  return workspacePackages;
}
