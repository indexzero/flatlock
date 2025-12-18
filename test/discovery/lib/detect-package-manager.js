/**
 * @fileoverview Phase 3: Package Manager Detection
 * Detects which package manager and lockfile format a repository uses
 *
 * Detection priority (when multiple lockfiles exist):
 * 1. pnpm (pnpm-lock.yaml)
 * 2. yarn (yarn.lock)
 * 3. npm (package-lock.json)
 *
 * This priority reflects that projects migrating typically keep old lockfiles
 * temporarily, so the "newer" format is usually the current one.
 */

/**
 * @typedef {Object} DetectionResult
 * @property {string|null} lockfile - Lockfile type: 'npm', 'pnpm', 'yarn-classic', 'yarn-berry'
 * @property {string|number|null} lockfileVersion - Version number/string from lockfile
 * @property {string|null} packageManager - Package manager from corepack field
 * @property {string|null} packageManagerVersion - Version from packageManager field
 * @property {boolean} isMonorepo - Whether workspace configuration exists
 * @property {string|null} monorepoTool - Monorepo tool: 'turborepo', 'lerna', 'nx', 'pnpm-workspaces', 'yarn-workspaces', 'npm-workspaces'
 * @property {string[]|null} workspaces - Workspace patterns from package.json or pnpm-workspace.yaml
 * @property {Object} files - Which files were found
 */

/**
 * @typedef {Object} RepositoryFiles
 * @property {string|null} packageJson
 * @property {string|null} packageLock
 * @property {string|null} pnpmLock
 * @property {string|null} pnpmWorkspace
 * @property {string|null} yarnLock
 * @property {string|null} yarnrcYml
 * @property {string|null} yarnrcClassic
 * @property {string|null} npmrc
 * @property {string|null} turboJson
 * @property {string|null} lernaJson
 * @property {string|null} nxJson
 */

/**
 * Detect package manager and lockfile format from repository files
 *
 * @param {RepositoryFiles} files - Repository files
 * @returns {DetectionResult}
 */
export function detectPackageManager(files) {
  const result = {
    lockfile: null,
    lockfileVersion: null,
    packageManager: null,
    packageManagerVersion: null,
    isMonorepo: false,
    monorepoTool: null,
    workspaces: null,
    files: {
      packageJson: !!files.packageJson,
      packageLock: !!files.packageLock,
      pnpmLock: !!files.pnpmLock,
      pnpmWorkspace: !!files.pnpmWorkspace,
      yarnLock: !!files.yarnLock,
      yarnrcYml: !!files.yarnrcYml,
      yarnrcClassic: !!files.yarnrcClassic,
      npmrc: !!files.npmrc,
      turboJson: !!files.turboJson,
      lernaJson: !!files.lernaJson,
      nxJson: !!files.nxJson,
    },
  };

  // Parse package.json if available
  let packageJson = null;
  if (files.packageJson) {
    try {
      packageJson = JSON.parse(files.packageJson);
    } catch {
      // Invalid JSON, continue without it
    }
  }

  // Check for corepack packageManager field
  if (packageJson?.packageManager) {
    const match = packageJson.packageManager.match(/^(npm|pnpm|yarn)@(.+)$/);
    if (match) {
      result.packageManager = match[1];
      result.packageManagerVersion = match[2];
    }
  }

  // Check for workspaces in package.json
  if (packageJson?.workspaces) {
    result.isMonorepo = true;
    result.workspaces = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson.workspaces.packages || [];
  }

  // Detect lockfile type (priority: pnpm > yarn > npm)
  if (files.pnpmLock) {
    result.lockfile = 'pnpm';
    result.lockfileVersion = detectPnpmVersion(files.pnpmLock);

    // pnpm workspaces detection
    if (files.pnpmWorkspace) {
      result.isMonorepo = true;
      result.monorepoTool = 'pnpm-workspaces';
      result.workspaces = parsePnpmWorkspace(files.pnpmWorkspace);
    }
  } else if (files.yarnLock) {
    // Distinguish between Yarn Classic and Berry
    if (isYarnBerry(files)) {
      result.lockfile = 'yarn-berry';
      result.lockfileVersion = detectYarnBerryVersion(files.yarnLock);
    } else {
      result.lockfile = 'yarn-classic';
      result.lockfileVersion = 1;
    }

    // Yarn workspaces (both classic and berry)
    if (result.isMonorepo && result.workspaces) {
      result.monorepoTool = 'yarn-workspaces';
    }
  } else if (files.packageLock) {
    result.lockfile = 'npm';
    result.lockfileVersion = detectNpmVersion(files.packageLock);

    // npm workspaces
    if (result.isMonorepo && result.workspaces) {
      result.monorepoTool = 'npm-workspaces';
    }
  }

  // Detect monorepo tools (these override workspace-based detection)
  if (files.turboJson) {
    result.isMonorepo = true;
    result.monorepoTool = 'turborepo';
  } else if (files.nxJson) {
    result.isMonorepo = true;
    result.monorepoTool = 'nx';
  } else if (files.lernaJson) {
    result.isMonorepo = true;
    result.monorepoTool = 'lerna';
  }

  return result;
}

/**
 * Detect pnpm lockfile version
 *
 * @param {string} content - pnpm-lock.yaml content
 * @returns {string|null}
 */
function detectPnpmVersion(content) {
  // Match: lockfileVersion: 5.4 or lockfileVersion: '6.0' or lockfileVersion: '9.0'
  const match = content.match(/lockfileVersion:\s*['"]?([^'"\s\n]+)/);
  return match ? match[1] : null;
}

/**
 * Detect npm lockfile version
 *
 * @param {string} content - package-lock.json content
 * @returns {number|null}
 */
function detectNpmVersion(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed.lockfileVersion || null;
  } catch {
    return null;
  }
}

/**
 * Check if a yarn project uses Berry (v2+)
 *
 * @param {RepositoryFiles} files
 * @returns {boolean}
 */
function isYarnBerry(files) {
  // .yarnrc.yml is Berry-only
  if (files.yarnrcYml) {
    return true;
  }

  // Check for __metadata section in yarn.lock (Berry format)
  if (files.yarnLock && files.yarnLock.includes('__metadata:')) {
    return true;
  }

  // Check for Berry-specific patterns in .yarnrc
  if (files.yarnrcClassic) {
    // Berry migrates .yarnrc to .yarnrc.yml, so if only .yarnrc exists,
    // it's likely classic, unless it has nodeLinker or other Berry options
    if (files.yarnrcClassic.includes('nodeLinker') || files.yarnrcClassic.includes('yarnPath')) {
      return true;
    }
  }

  return false;
}

/**
 * Detect Yarn Berry lockfile version
 *
 * @param {string} content - yarn.lock content
 * @returns {string|null}
 */
function detectYarnBerryVersion(content) {
  // Berry lockfiles have __metadata with version info
  // __metadata:
  //   version: 8
  //   cacheKey: 10c0
  const match = content.match(/__metadata:\s*\n\s*version:\s*(\d+)/);
  return match ? match[1] : 'berry';
}

/**
 * Parse pnpm-workspace.yaml to extract workspace patterns
 *
 * @param {string} content - pnpm-workspace.yaml content
 * @returns {string[]|null}
 */
function parsePnpmWorkspace(content) {
  // Simple YAML parsing for workspace packages
  // packages:
  //   - 'packages/*'
  //   - 'apps/*'
  const packagesMatch = content.match(/packages:\s*\n((?:\s*-\s*.+\n?)+)/);
  if (!packagesMatch) return null;

  const lines = packagesMatch[1].split('\n');
  const packages = [];

  for (const line of lines) {
    const match = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (match) {
      packages.push(match[1]);
    }
  }

  return packages.length > 0 ? packages : null;
}

/**
 * Categorize a detection result into a lockfile format bucket
 *
 * @param {DetectionResult} detection
 * @returns {string} - Bucket key like 'npm-v3', 'pnpm-v9', 'yarn-classic', 'yarn-berry', 'none'
 */
export function categorizeLockfile(detection) {
  if (!detection.lockfile) {
    return 'none';
  }

  const { lockfile, lockfileVersion } = detection;

  switch (lockfile) {
    case 'npm': {
      const version = typeof lockfileVersion === 'number' ? lockfileVersion : parseInt(lockfileVersion, 10);
      if (version === 1) return 'npm-v1';
      if (version === 2) return 'npm-v2';
      if (version === 3) return 'npm-v3';
      return 'npm-unknown';
    }

    case 'pnpm': {
      const versionStr = String(lockfileVersion);
      // Handle formats like '5.4', '6.0', '9.0'
      const major = parseInt(versionStr.split('.')[0], 10);
      if (major <= 5) return 'pnpm-v5';
      if (major === 6) return 'pnpm-v6';
      if (major >= 9) return 'pnpm-v9';
      return 'pnpm-unknown';
    }

    case 'yarn-classic':
      return 'yarn-classic';

    case 'yarn-berry':
      return 'yarn-berry';

    default:
      return 'unknown';
  }
}

/**
 * Get human-readable lockfile format name
 *
 * @param {DetectionResult} detection
 * @returns {string}
 */
export function formatLockfileType(detection) {
  if (!detection.lockfile) {
    return 'No lockfile';
  }

  const category = categorizeLockfile(detection);
  const parts = category.split('-');

  switch (parts[0]) {
    case 'npm':
      return `npm (lockfileVersion: ${detection.lockfileVersion})`;
    case 'pnpm':
      return `pnpm (lockfileVersion: ${detection.lockfileVersion})`;
    case 'yarn':
      return parts[1] === 'classic' ? 'Yarn Classic (v1)' : `Yarn Berry (v${detection.lockfileVersion || '2+'})`;
    default:
      return category;
  }
}
