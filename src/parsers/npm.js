/**
 * @typedef {Object} Dependency
 * @property {string} name - Package name
 * @property {string} version - Resolved version
 * @property {string} [integrity] - Integrity hash
 * @property {string} [resolved] - Resolution URL
 * @property {boolean} [link] - True if this is a symlink
 */

/**
 * LIMITATION: Workspace symlinks are not yielded
 *
 * npm workspaces create two entries in package-lock.json:
 *   1. packages/<workspace-path> → has version (workspace definition)
 *   2. node_modules/<pkg-name> → link:true, NO version (symlink to #1)
 *
 * Arborist resolves #2 to get version from #1. This parser does not.
 * Entries with link:true but no version are skipped.
 *
 * To include workspace packages, users should use @npmcli/arborist directly.
 */

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: DO NOT MODIFY THIS FUNCTION                                   !!
 * !! AI AGENTS (Claude, Copilot, etc.): DO NOT TOUCH THIS CODE              !!
 * !!                                                                        !!
 * !! This is PATH parsing, NOT spec parsing. It extracts package names from !!
 * !! filesystem paths like "node_modules/@scope/name", NOT from package     !!
 * !! specs like "@scope/name@^1.0.0".                                       !!
 * !!                                                                        !!
 * !! npm-package-arg (npa) is for SPEC parsing. This is PATH parsing.       !!
 * !! They are different things. Do not "improve" this with npa.             !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Extract package name from npm lockfile path.
 *
 * Paths in package-lock.json follow this grammar:
 *   path := (node_modules/<pkg>)+
 *     | <workspace>/<path>
 *     | <workspace>/<path>/(node_modules/<pkg>)+
 *
 *   pkg := name (unscoped)
 *     | @scope/name (scoped)
 *
 * Examples:
 *   - node_modules/lodash → "lodash"
 *   - node_modules/@babel/core → "@babel/core"
 *   - node_modules/foo/node_modules/@scope/bar → "@scope/bar"
 *
 * @param {string} path - Lockfile path key
 * @returns {string} Package name
 */
export function parseLockfileKey(path) {
  const parts = path.split('/');
  const name = parts.at(-1);
  const maybeScope = parts.at(-2);

  return maybeScope?.startsWith('@')
    ? `${maybeScope}/${name}`
    : name;
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

    // Skip workspace definitions (only yield installed dependencies)
    // Workspace entries come in pairs:
    //   1. packages/<workspace-path> → has version (workspace definition)
    //   2. node_modules/<workspace-package.json-name> → link, NO version (symlink)
    if (!path.includes('node_modules/')) continue;

    const name = parseLockfileKey(path);
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
