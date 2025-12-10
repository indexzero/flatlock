/**
 * @typedef {Object} Dependency
 * @property {string} name - Package name
 * @property {string} version - Resolved version
 * @property {string} [integrity] - Integrity hash
 * @property {string} [resolved] - Resolution URL
 * @property {boolean} [link] - True if this is a symlink
 */

/**
 * Extract package name from node_modules path
 * @param {string} path - Path like "node_modules/@babel/core" or "node_modules/lodash"
 * @returns {string} Package name like "@babel/core" or "lodash"
 */
function extractNameFromPath(path) {
  // Handle nested node_modules by taking the last segment
  // "node_modules/a/node_modules/b" → "b"
  const parts = path.split('node_modules/');
  return parts[parts.length - 1];
}

/**
 * Parse npm package-lock.json (v1, v2, v3)
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Parser options
 * @returns {Generator<Dependency>}
 */
export function* fromPackageLock(content, _options = {}) {
  const lockfile = JSON.parse(content);
  const packages = lockfile.packages || {};

  for (const [path, pkg] of Object.entries(packages)) {
    // Skip root package
    if (path === '') continue;

    const name = extractNameFromPath(path);
    const { version, integrity, resolved, link } = pkg;

    // Only yield if we have a name and version
    if (name && version) {
      const dep = { name, version };
      if (integrity) dep.integrity = integrity;
      if (resolved) dep.resolved = resolved;
      if (link) dep.link = true;
      yield dep;
    }
  }
}
