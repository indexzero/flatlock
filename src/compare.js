import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Arborist from '@npmcli/arborist';
import { parseSyml } from '@yarnpkg/parsers';
import yaml from 'js-yaml';
import { detectType, fromPath, Type } from './index.js';
import { parseYarnBerryKey, parseYarnClassic, parseYarnClassicKey } from './parsers/index.js';
import { parseSpec as parsePnpmSpec } from './parsers/pnpm.js';

/**
 * @typedef {Object} CompareOptions
 * @property {string} [tmpDir] - Temp directory for Arborist (npm only)
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {string} type - Lockfile type
 * @property {boolean | null} identical - Whether flatlock matches comparison parser
 * @property {number} flatlockCount - Number of packages found by flatlock
 * @property {number} [comparisonCount] - Number of packages found by comparison parser
 * @property {number} [workspaceCount] - Number of workspace packages skipped
 * @property {string[]} [onlyInFlatlock] - Packages only found by flatlock
 * @property {string[]} [onlyInComparison] - Packages only found by comparison parser
 */

/**
 * @typedef {Object} PackagesResult
 * @property {Set<string>} packages - Set of package@version strings
 * @property {number} workspaceCount - Number of workspace packages skipped
 */

/**
 * Get packages from npm lockfile using Arborist (ground truth)
 * @param {string} content - Lockfile content
 * @param {string} _filepath - Path to lockfile (unused)
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromNpm(content, _filepath, options = {}) {
  // Arborist needs a directory with package-lock.json
  const tmpDir = options.tmpDir || (await mkdtemp(join(tmpdir(), 'flatlock-cmp-')));
  const lockPath = join(tmpDir, 'package-lock.json');
  const pkgPath = join(tmpDir, 'package.json');

  try {
    await writeFile(lockPath, content);

    // Create minimal package.json from lockfile root entry
    const lockfile = JSON.parse(content);
    const root = lockfile.packages?.[''] || {};
    const pkg = {
      name: root.name || 'arborist-temp',
      version: root.version || '1.0.0'
    };
    await writeFile(pkgPath, JSON.stringify(pkg));

    const arb = new Arborist({ path: tmpDir });
    const tree = await arb.loadVirtual();

    const packages = new Set();
    let workspaceCount = 0;

    for (const node of tree.inventory.values()) {
      if (node.isRoot) continue;
      // Skip workspace symlinks (link:true, no version in raw lockfile)
      if (node.isLink) {
        workspaceCount++;
        continue;
      }
      // Skip workspace package definitions (not in node_modules)
      // Flatlock only yields packages from node_modules/ paths
      if (node.location && !node.location.includes('node_modules')) {
        workspaceCount++;
        continue;
      }
      if (node.name && node.version) {
        packages.add(`${node.name}@${node.version}`);
      }
    }

    return { packages, workspaceCount };
  } finally {
    if (!options.tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Get packages from yarn classic lockfile
 * @param {string} content - Lockfile content
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromYarnClassic(content) {
  const parsed = parseYarnClassic(content);

  if (parsed.type !== 'success' && parsed.type !== 'merge') {
    throw new Error('Failed to parse yarn.lock');
  }

  const packages = new Set();
  let workspaceCount = 0;

  for (const [key, value] of Object.entries(parsed.object)) {
    if (key === '__metadata') continue;

    // Skip workspace/link entries - flatlock only cares about external dependencies
    const resolved = value.resolved || '';
    if (resolved.startsWith('file:') || resolved.startsWith('link:')) {
      workspaceCount++;
      continue;
    }

    // Extract package name from lockfile key
    const name = parseYarnClassicKey(key);
    if (name && value.version) {
      packages.add(`${name}@${value.version}`);
    }
  }

  return { packages, workspaceCount };
}

/**
 * Get packages from yarn berry lockfile
 * @param {string} content - Lockfile content
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromYarnBerry(content) {
  const parsed = parseSyml(content);

  const packages = new Set();
  let workspaceCount = 0;

  for (const [key, value] of Object.entries(parsed)) {
    if (key === '__metadata') continue;

    // Skip workspace/link entries - flatlock only cares about external dependencies
    const resolution = value.resolution || '';
    if (
      resolution.startsWith('workspace:') ||
      resolution.startsWith('portal:') ||
      resolution.startsWith('link:')
    ) {
      workspaceCount++;
      continue;
    }

    // Extract package name from lockfile key
    const name = parseYarnBerryKey(key);
    if (name && value.version) {
      packages.add(`${name}@${value.version}`);
    }
  }

  return { packages, workspaceCount };
}

/**
 * Get packages from pnpm lockfile
 * @param {string} content - Lockfile content
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromPnpm(content) {
  const parsed = /** @type {{ packages?: Record<string, any> }} */ (yaml.load(content));

  const packages = new Set();
  let workspaceCount = 0;
  const pkgs = parsed.packages || {};

  for (const [key, value] of Object.entries(pkgs)) {
    // Skip link/file entries - flatlock only cares about external dependencies
    // Keys can be: link:path, file:path, or @pkg@file:path
    if (
      key.startsWith('link:') ||
      key.startsWith('file:') ||
      key.includes('@link:') ||
      key.includes('@file:')
    ) {
      workspaceCount++;
      continue;
    }
    // Also skip if resolution.type is 'directory' (workspace)
    if (value.resolution?.type === 'directory') {
      workspaceCount++;
      continue;
    }

    // Extract name and version from pnpm lockfile key
    const { name, version } = parsePnpmSpec(key);
    if (name && version) {
      packages.add(`${name}@${version}`);
    }
  }

  return { packages, workspaceCount };
}

/**
 * Compare flatlock output against established parser for a lockfile
 * @param {string} filepath - Path to lockfile
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<ComparisonResult>}
 */
export async function compare(filepath, options = {}) {
  const content = await readFile(filepath, 'utf8');
  const type = detectType({ path: filepath, content });

  const flatlockSet = new Set();
  for await (const dep of fromPath(filepath)) {
    if (dep.name && dep.version) {
      flatlockSet.add(`${dep.name}@${dep.version}`);
    }
  }

  let comparisonResult;
  switch (type) {
    case Type.NPM:
      comparisonResult = await getPackagesFromNpm(content, filepath, options);
      break;
    case Type.YARN_CLASSIC:
      comparisonResult = await getPackagesFromYarnClassic(content);
      break;
    case Type.YARN_BERRY:
      comparisonResult = await getPackagesFromYarnBerry(content);
      break;
    case Type.PNPM:
      comparisonResult = await getPackagesFromPnpm(content);
      break;
    default:
      return { type, identical: null, flatlockCount: flatlockSet.size };
  }

  const { packages: comparisonSet, workspaceCount } = comparisonResult;
  const onlyInFlatlock = new Set([...flatlockSet].filter(x => !comparisonSet.has(x)));
  const onlyInComparison = new Set([...comparisonSet].filter(x => !flatlockSet.has(x)));
  const identical = onlyInFlatlock.size === 0 && onlyInComparison.size === 0;

  return {
    type,
    identical,
    flatlockCount: flatlockSet.size,
    comparisonCount: comparisonSet.size,
    workspaceCount,
    onlyInFlatlock: [...onlyInFlatlock],
    onlyInComparison: [...onlyInComparison]
  };
}

/**
 * Compare multiple lockfiles
 * @param {string[]} filepaths - Paths to lockfiles
 * @param {CompareOptions} [options] - Options
 * @returns {AsyncGenerator<ComparisonResult & { filepath: string }>}
 */
export async function* compareAll(filepaths, options = {}) {
  for (const filepath of filepaths) {
    yield { filepath, ...(await compare(filepath, options)) };
  }
}
