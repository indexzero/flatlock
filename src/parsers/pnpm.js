import yaml from 'js-yaml';

/**
 * @typedef {Object} Dependency
 * @property {string} name - Package name
 * @property {string} version - Resolved version
 * @property {string} [integrity] - Integrity hash
 * @property {string} [resolved] - Resolution URL
 * @property {boolean} [link] - True if this is a symlink
 */

/**
 * Parse pnpm package spec to extract name and version
 * Examples:
 *   "/@babel/core@7.23.0" → { name: "@babel/core", version: "7.23.0" }
 *   "/lodash@4.17.21" → { name: "lodash", version: "4.17.21" }
 *   "link:packages/foo" → { name: null, version: null } (skip these)
 *
 * @param {string} spec - Package spec from pnpm lockfile
 * @returns {{ name: string | null, version: string | null }}
 */
function parseSpec(spec) {
  // Skip special protocols
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { name: null, version: null };
  }

  // Remove leading slash if present
  const cleaned = spec.startsWith('/') ? spec.slice(1) : spec;

  // Find the last @ which separates name from version
  // For scoped packages like "@babel/core@7.23.0", we need the last @
  const lastAtIndex = cleaned.lastIndexOf('@');

  if (lastAtIndex === -1) {
    return { name: null, version: null };
  }

  const name = cleaned.slice(0, lastAtIndex);
  const versionPart = cleaned.slice(lastAtIndex + 1);

  // Extract version (may have additional info like "_@babel+core@7.23.0")
  // For peer dependencies, format can be: "lodash@4.17.21(@types/node@20.0.0)"
  const version = versionPart.split('(')[0];

  return { name, version };
}

/**
 * Parse pnpm-lock.yaml (v5.4, v6, v9)
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Parser options
 * @returns {Generator<Dependency>}
 */
export function* fromPnpmLock(content, _options = {}) {
  const lockfile = yaml.load(content);
  const packages = lockfile.packages || {};

  for (const [spec, pkg] of Object.entries(packages)) {
    const { name, version } = parseSpec(spec);

    // Skip if we couldn't parse name/version
    if (!name || !version) continue;

    const resolution = pkg.resolution || {};
    const integrity = resolution.integrity;
    const resolved = resolution.tarball;
    const link = spec.startsWith('link:') || resolution.type === 'directory';

    const dep = { name, version };
    if (integrity) dep.integrity = integrity;
    if (resolved) dep.resolved = resolved;
    if (link) dep.link = true;
    yield dep;
  }

  // Also parse importers (workspace packages)
  const importers = lockfile.importers || {};
  for (const [_importerPath, importer] of Object.entries(importers)) {
    // Importers are workspace packages, marked as links
    const deps = { ...importer.dependencies, ...importer.devDependencies };
    for (const [name, versionSpec] of Object.entries(deps)) {
      // Parse version from spec like "link:packages/foo" or "1.2.3"
      if (typeof versionSpec === 'string' && versionSpec.startsWith('link:')) {
        yield {
          name,
          version: '0.0.0', // Workspace packages don't have a real version in lockfile
          link: true
        };
      }
    }
  }
}
