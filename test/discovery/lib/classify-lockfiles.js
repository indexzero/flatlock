/**
 * Lockfile Classification
 *
 * Detects lockfile type and version from content, providing detailed
 * classification information for test organization.
 *
 * @module test/discovery/lib/classify-lockfiles
 */

import { readFile } from 'node:fs/promises';
import { versionToEra, ERAS } from './eras.js';

/**
 * @typedef {Object} LockfileClassification
 * @property {'npm'|'pnpm'|'yarn-classic'|'yarn-berry'|'unknown'} type - Lockfile type
 * @property {string|number|null} version - Lockfile version (e.g., 3, '6.0', '1')
 * @property {string|null} era - Era key (e.g., 'npm-v3', 'pnpm-v6')
 * @property {boolean} valid - Whether the lockfile appears valid
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} NpmClassification
 * @property {'npm'} type
 * @property {1|2|3} version - lockfileVersion
 * @property {boolean} hasPackages - Has packages field (v2+)
 * @property {boolean} hasDependencies - Has legacy dependencies field
 * @property {string|null} name - Package name from lockfile
 * @property {number} packageCount - Number of packages
 */

/**
 * @typedef {Object} PnpmClassification
 * @property {'pnpm'} type
 * @property {string} version - lockfileVersion (e.g., '5.4', '6.0', '9.0')
 * @property {boolean} isShrinkwrap - Is old shrinkwrap format
 * @property {boolean} hasImporters - Has importers (workspaces)
 * @property {boolean} hasPatches - Has patchedDependencies
 * @property {boolean} hasCatalogs - Has catalogs (v9+)
 * @property {number} packageCount - Number of packages
 */

/**
 * @typedef {Object} YarnClassicClassification
 * @property {'yarn-classic'} type
 * @property {1} version - Always 1
 * @property {boolean} hasHeader - Has "# yarn lockfile v1" header
 * @property {number} entryCount - Number of lockfile entries
 */

/**
 * @typedef {Object} YarnBerryClassification
 * @property {'yarn-berry'} type
 * @property {number} version - __metadata.version (6, 8, etc.)
 * @property {string|null} cacheKey - __metadata.cacheKey
 * @property {boolean} hasZeroInstalls - Likely using zero-installs
 * @property {number} entryCount - Number of lockfile entries
 */

/**
 * Classify an npm package-lock.json file.
 *
 * @param {string} content - File content
 * @returns {LockfileClassification & NpmClassification | null}
 */
export function classifyNpm(content) {
  try {
    const parsed = JSON.parse(content);

    // Must have lockfileVersion
    if (typeof parsed.lockfileVersion !== 'number') {
      return null;
    }

    const version = parsed.lockfileVersion;
    const hasPackages = typeof parsed.packages === 'object' && parsed.packages !== null;
    const hasDependencies = typeof parsed.dependencies === 'object' && parsed.dependencies !== null;

    // Count packages
    let packageCount = 0;
    if (hasPackages) {
      packageCount = Object.keys(parsed.packages).filter(k => k !== '').length;
    } else if (hasDependencies) {
      packageCount = countNpmDependencies(parsed.dependencies);
    }

    return {
      type: 'npm',
      version,
      era: versionToEra('npm', version),
      valid: true,
      metadata: {
        hasPackages,
        hasDependencies,
        name: parsed.name || null,
        packageCount
      }
    };
  } catch {
    return null;
  }
}

/**
 * Count dependencies in npm v1 format (recursive).
 *
 * @param {Object} deps - Dependencies object
 * @param {Set<string>} [seen] - Already counted (for cycles)
 * @returns {number}
 */
function countNpmDependencies(deps, seen = new Set()) {
  let count = 0;

  for (const [name, info] of Object.entries(deps)) {
    const key = `${name}@${info.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    count++;

    if (info.dependencies) {
      count += countNpmDependencies(info.dependencies, seen);
    }
  }

  return count;
}

/**
 * Classify a pnpm-lock.yaml file.
 *
 * @param {string} content - File content
 * @returns {LockfileClassification & PnpmClassification | null}
 */
export function classifyPnpm(content) {
  // Extract lockfileVersion with regex (faster than full YAML parse)
  const lockfileMatch = content.match(/lockfileVersion:\s*['"]?([^'\s\n]+)/);
  const shrinkwrapMatch = content.match(/shrinkwrapVersion:\s*['"]?([^'\s\n]+)/);

  if (!lockfileMatch && !shrinkwrapMatch) {
    return null;
  }

  const isShrinkwrap = !lockfileMatch && !!shrinkwrapMatch;
  const version = lockfileMatch?.[1] || shrinkwrapMatch?.[1];

  // Feature detection via regex
  const hasImporters = /^importers:/m.test(content);
  const hasPatches = /^patchedDependencies:/m.test(content);
  const hasCatalogs = /^catalogs:/m.test(content);

  // Count packages via regex
  const packagesSection = content.match(/^packages:[\s\S]*?(?=^[a-zA-Z]|\Z)/m);
  let packageCount = 0;
  if (packagesSection) {
    // Count entries starting with quotes at specific indentation
    const matches = packagesSection[0].match(/^\s{2}['"]?[/@a-zA-Z]/gm);
    packageCount = matches ? matches.length : 0;
  }

  return {
    type: 'pnpm',
    version,
    era: versionToEra('pnpm', version),
    valid: true,
    metadata: {
      isShrinkwrap,
      hasImporters,
      hasPatches,
      hasCatalogs,
      packageCount
    }
  };
}

/**
 * Classify a yarn.lock file (classic or berry).
 *
 * @param {string} content - File content
 * @param {Object} [options] - Options
 * @param {string} [options.yarnrcYml] - Content of .yarnrc.yml if available
 * @returns {LockfileClassification | null}
 */
export function classifyYarn(content, options = {}) {
  // Berry detection: __metadata section
  const metadataMatch = content.match(/__metadata:\s*\n\s+version:\s*['"]?(\d+)/);

  if (metadataMatch || options.yarnrcYml) {
    return classifyYarnBerry(content, metadataMatch);
  }

  // Classic detection: header or fallback
  return classifyYarnClassic(content);
}

/**
 * Classify a yarn classic (v1) lockfile.
 *
 * @param {string} content - File content
 * @returns {LockfileClassification & YarnClassicClassification}
 */
function classifyYarnClassic(content) {
  const hasHeader = content.startsWith('# yarn lockfile v1');

  // Count entries (lines starting with a package spec)
  // Classic format: "package@version":
  const entryMatches = content.match(/^["']?[@a-zA-Z][^:\n]*["']?:/gm);
  const entryCount = entryMatches ? entryMatches.length : 0;

  return {
    type: 'yarn-classic',
    version: 1,
    era: 'yarn-classic',
    valid: hasHeader || entryCount > 0,
    metadata: {
      hasHeader,
      entryCount
    }
  };
}

/**
 * Classify a yarn berry (v2+) lockfile.
 *
 * @param {string} content - File content
 * @param {RegExpMatchArray|null} metadataMatch - Regex match for __metadata
 * @returns {LockfileClassification & YarnBerryClassification}
 */
function classifyYarnBerry(content, metadataMatch) {
  const version = metadataMatch ? parseInt(metadataMatch[1], 10) : 6;

  // Extract cacheKey
  const cacheKeyMatch = content.match(/__metadata:\s*[\s\S]*?cacheKey:\s*['"]?(\d+)/);
  const cacheKey = cacheKeyMatch ? cacheKeyMatch[1] : null;

  // Check for zero-installs indicators
  const hasZeroInstalls = content.includes('linkType: hard') ||
    content.includes('.yarn/cache');

  // Count entries (skip __metadata)
  const entryMatches = content.match(/^["']?[@a-zA-Z][^:\n]*["']?:/gm);
  const entryCount = entryMatches ? entryMatches.length : 0;

  return {
    type: 'yarn-berry',
    version,
    era: 'yarn-berry',
    valid: true,
    metadata: {
      cacheKey,
      hasZeroInstalls,
      entryCount
    }
  };
}

/**
 * Classify a lockfile from its content.
 * Attempts to detect type and version automatically.
 *
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Options
 * @param {string} [options.path] - File path hint
 * @param {string} [options.yarnrcYml] - .yarnrc.yml content if available
 * @returns {LockfileClassification}
 */
export function classifyContent(content, options = {}) {
  const { path, yarnrcYml } = options;

  // Try npm first (JSON format is distinctive)
  if (content.trimStart().startsWith('{')) {
    const npm = classifyNpm(content);
    if (npm) return npm;
  }

  // Check for pnpm indicators
  if (content.includes('lockfileVersion:') || content.includes('shrinkwrapVersion:')) {
    const pnpm = classifyPnpm(content);
    if (pnpm) return pnpm;
  }

  // Check for yarn
  if (content.includes('__metadata:') || content.startsWith('# yarn lockfile')) {
    const yarn = classifyYarn(content, { yarnrcYml });
    if (yarn) return yarn;
  }

  // Try yarn classic as fallback for .lock files
  if (path?.endsWith('.lock')) {
    const yarn = classifyYarn(content, { yarnrcYml });
    if (yarn?.valid) return yarn;
  }

  // Unknown type
  return {
    type: 'unknown',
    version: null,
    era: null,
    valid: false,
    metadata: {}
  };
}

/**
 * Classify a lockfile from a file path.
 *
 * @param {string} filePath - Path to lockfile
 * @param {Object} [options] - Options
 * @param {string} [options.yarnrcPath] - Path to .yarnrc.yml
 * @returns {Promise<LockfileClassification>}
 */
export async function classifyFile(filePath, options = {}) {
  const content = await readFile(filePath, 'utf8');

  let yarnrcYml = null;
  if (options.yarnrcPath) {
    try {
      yarnrcYml = await readFile(options.yarnrcPath, 'utf8');
    } catch {
      // Ignore missing .yarnrc.yml
    }
  }

  return classifyContent(content, { path: filePath, yarnrcYml });
}

/**
 * Batch classify multiple lockfiles.
 *
 * @param {Array<{path: string, content?: string}>} lockfiles - Lockfiles to classify
 * @returns {Promise<Map<string, LockfileClassification>>}
 */
export async function classifyBatch(lockfiles) {
  const results = new Map();

  for (const lockfile of lockfiles) {
    const content = lockfile.content || await readFile(lockfile.path, 'utf8');
    const classification = classifyContent(content, { path: lockfile.path });
    results.set(lockfile.path, classification);
  }

  return results;
}

/**
 * Get the canonical directory name for a classification.
 * Used for organizing test fixtures.
 *
 * @param {LockfileClassification} classification - Classification result
 * @returns {string} Directory name (e.g., "npm/v3", "pnpm/v6")
 */
export function getCanonicalPath(classification) {
  switch (classification.type) {
    case 'npm':
      return `npm/v${classification.version}`;
    case 'pnpm':
      if (classification.metadata?.isShrinkwrap) {
        return 'pnpm/shrinkwrap';
      }
      const majorVersion = String(classification.version).split('.')[0];
      return `pnpm/v${majorVersion}`;
    case 'yarn-classic':
      return 'yarn-classic/v1';
    case 'yarn-berry':
      return 'yarn-berry/v2+';
    default:
      return 'unknown';
  }
}

/**
 * Summarize classification results.
 *
 * @param {Map<string, LockfileClassification>} classifications - Classification results
 * @returns {Object} Summary by type and version
 */
export function summarizeClassifications(classifications) {
  const summary = {
    npm: { v1: 0, v2: 0, v3: 0 },
    pnpm: { shrinkwrap: 0, v5: 0, v6: 0, v9: 0 },
    'yarn-classic': { v1: 0 },
    'yarn-berry': { 'v2+': 0 },
    unknown: { count: 0 }
  };

  for (const classification of classifications.values()) {
    const type = classification.type;

    if (type === 'unknown') {
      summary.unknown.count++;
      continue;
    }

    const path = getCanonicalPath(classification);
    const [, version] = path.split('/');

    if (summary[type] && version in summary[type]) {
      summary[type][version]++;
    }
  }

  return summary;
}

/**
 * Check if a lockfile contains workspace configuration.
 *
 * @param {string} content - Lockfile content
 * @param {LockfileClassification} classification - Classification result
 * @returns {boolean}
 */
export function hasWorkspaces(content, classification) {
  switch (classification.type) {
    case 'npm':
      try {
        const parsed = JSON.parse(content);
        // v2+ has packages with workspace entries
        if (parsed.packages) {
          return Object.keys(parsed.packages).some(k =>
            k && !k.includes('node_modules')
          );
        }
        return false;
      } catch {
        return false;
      }

    case 'pnpm':
      return classification.metadata?.hasImporters || false;

    case 'yarn-classic':
    case 'yarn-berry':
      // Look for workspace: protocol references
      return content.includes('workspace:');

    default:
      return false;
  }
}

/**
 * Extract workspace paths from a lockfile.
 *
 * @param {string} content - Lockfile content
 * @param {LockfileClassification} classification - Classification result
 * @returns {string[]}
 */
export function extractWorkspaces(content, classification) {
  const workspaces = [];

  switch (classification.type) {
    case 'npm':
      try {
        const parsed = JSON.parse(content);
        if (parsed.packages) {
          for (const key of Object.keys(parsed.packages)) {
            if (key && !key.includes('node_modules')) {
              workspaces.push(key || '.');
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
      break;

    case 'pnpm':
      // Extract from importers section
      const importersMatch = content.match(/^importers:\s*\n([\s\S]*?)(?=^[a-zA-Z]|\Z)/m);
      if (importersMatch) {
        const matches = importersMatch[1].match(/^\s{2}['"]?([^'":]+)/gm);
        if (matches) {
          for (const match of matches) {
            workspaces.push(match.trim().replace(/['"]/g, ''));
          }
        }
      }
      break;
  }

  return workspaces;
}
