import { constants } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSyml } from '@yarnpkg/parsers';
import yaml from 'js-yaml';
import { detectType, fromPath, Type } from './index.js';
import { parseYarnBerryKey, parseYarnClassic, parseYarnClassicKey } from './parsers/index.js';
import { parseSpec as parsePnpmSpec } from './parsers/pnpm.js';

const require = createRequire(import.meta.url);

// Lazy-loaded optional dependencies
let Arborist = null;
let readWantedLockfile = null;
let cyclonedxCliPath = null;

/**
 * Try to load @npmcli/arborist (optional dependency)
 * @returns {Promise<typeof import('@npmcli/arborist') | null>}
 */
async function loadArborist() {
  if (Arborist === null) {
    try {
      const mod = await import('@npmcli/arborist');
      Arborist = mod.default;
    } catch {
      Arborist = false; // Mark as unavailable
    }
  }
  return Arborist || null;
}

/**
 * Try to load @pnpm/lockfile.fs (optional dependency)
 * @returns {Promise<typeof import('@pnpm/lockfile.fs').readWantedLockfile | null>}
 */
async function loadPnpmLockfileFs() {
  if (readWantedLockfile === null) {
    try {
      const mod = await import('@pnpm/lockfile.fs');
      readWantedLockfile = mod.readWantedLockfile;
    } catch {
      readWantedLockfile = false; // Mark as unavailable
    }
  }
  return readWantedLockfile || null;
}

/**
 * Try to resolve @cyclonedx/cyclonedx-npm CLI path (optional dependency)
 * @returns {string | null}
 */
function loadCycloneDxCliPath() {
  if (cyclonedxCliPath === null) {
    try {
      cyclonedxCliPath = require.resolve('@cyclonedx/cyclonedx-npm/bin/cyclonedx-npm-cli.js');
    } catch {
      cyclonedxCliPath = false; // Mark as unavailable
    }
  }
  return cyclonedxCliPath || null;
}

/**
 * @typedef {Object} CompareOptions
 * @property {string} [tmpDir] - Temp directory for Arborist/CycloneDX (npm only)
 * @property {string[]} [workspace] - Workspace paths for CycloneDX (-w flag)
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {string} type - Lockfile type
 * @property {string} [source] - Comparison source used (e.g., '@npmcli/arborist', '@cyclonedx/cyclonedx-npm')
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
 * @property {string} source - Comparison source used
 */

/**
 * Get packages from npm lockfile using Arborist (ground truth)
 * @param {string} content - Lockfile content
 * @param {string} _filepath - Path to lockfile (unused)
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult | null>}
 */
async function getPackagesFromArborist(content, _filepath, options = {}) {
  const Arb = await loadArborist();
  if (!Arb) return null;

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

    const arb = new Arb({ path: tmpDir });
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

    return { packages, workspaceCount, source: '@npmcli/arborist' };
  } finally {
    if (!options.tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Get packages from npm lockfile using CycloneDX SBOM generation
 * @param {string} content - Lockfile content
 * @param {string} filepath - Path to lockfile
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult | null>}
 */
async function getPackagesFromCycloneDX(content, filepath, options = {}) {
  const cliPath = loadCycloneDxCliPath();
  if (!cliPath) return null;

  // CycloneDX needs a directory with package-lock.json and package.json
  const tmpDir = options.tmpDir || (await mkdtemp(join(tmpdir(), 'flatlock-cdx-')));
  const lockPath = join(tmpDir, 'package-lock.json');
  const pkgPath = join(tmpDir, 'package.json');

  try {
    await writeFile(lockPath, content);

    // Create minimal package.json from lockfile root entry
    const lockfile = JSON.parse(content);
    const root = lockfile.packages?.[''] || {};
    const pkg = {
      name: root.name || 'cyclonedx-temp',
      version: root.version || '1.0.0'
    };
    await writeFile(pkgPath, JSON.stringify(pkg));

    const args = [
      cliPath,
      '--output-format', 'JSON',
      '--output-file', '-',
      '--package-lock-only' // Don't require node_modules
    ];

    // Add workspace flags if specified
    if (options.workspace) {
      for (const ws of [].concat(options.workspace)) {
        args.push('-w', ws);
      }
    }

    const sbomBuffer = execFileSync(process.execPath, args, {
      cwd: tmpDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'buffer',
      maxBuffer: constants.MAX_LENGTH
    });

    const sbom = JSON.parse(sbomBuffer.toString('utf8'));
    const packages = new Set();

    for (const component of sbom.components || []) {
      if (component.name && component.version) {
        packages.add(`${component.name}@${component.version}`);
      }
    }

    return { packages, workspaceCount: 0, source: '@cyclonedx/cyclonedx-npm' };
  } finally {
    if (!options.tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Get packages from npm lockfile - tries Arborist first, falls back to CycloneDX
 * @param {string} content - Lockfile content
 * @param {string} filepath - Path to lockfile
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromNpm(content, filepath, options = {}) {
  // Try Arborist first (faster, more accurate)
  const arboristResult = await getPackagesFromArborist(content, filepath, options);
  if (arboristResult) return arboristResult;

  // Fall back to CycloneDX
  const cyclonedxResult = await getPackagesFromCycloneDX(content, filepath, options);
  if (cyclonedxResult) return cyclonedxResult;

  throw new Error('No npm comparison parser available. Install @npmcli/arborist or @cyclonedx/cyclonedx-npm');
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

  return { packages, workspaceCount, source: '@yarnpkg/lockfile' };
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

  return { packages, workspaceCount, source: '@yarnpkg/parsers' };
}

/**
 * Get packages from pnpm lockfile using @pnpm/lockfile.fs (official parser)
 * @param {string} _content - Lockfile content (unused, reads from disk)
 * @param {string} filepath - Path to lockfile
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult | null>}
 */
async function getPackagesFromPnpmOfficial(_content, filepath, options = {}) {
  const readLockfile = await loadPnpmLockfileFs();
  if (!readLockfile) return null;

  const projectDir = dirname(filepath);

  try {
    const lockfile = await readLockfile(projectDir, {
      ignoreIncompatible: true
    });

    if (!lockfile) return null;

    const packages = new Set();
    let workspaceCount = 0;
    const pkgs = lockfile.packages || {};

    // If no packages found, likely version incompatibility - fall back to js-yaml
    if (Object.keys(pkgs).length === 0) {
      return null;
    }

    for (const [key, value] of Object.entries(pkgs)) {
      // Skip link/file entries
      if (
        key.startsWith('link:') ||
        key.startsWith('file:') ||
        key.includes('@link:') ||
        key.includes('@file:')
      ) {
        workspaceCount++;
        continue;
      }

      const { name, version } = parsePnpmSpec(key);
      if (name && version) {
        packages.add(`${name}@${version}`);
      }
    }

    return { packages, workspaceCount, source: '@pnpm/lockfile.fs' };
  } catch {
    // Fall back to js-yaml if official parser fails (version incompatibility)
    return null;
  }
}

/**
 * Get packages from pnpm lockfile using js-yaml (fallback)
 * @param {string} content - Lockfile content
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromPnpmYaml(content) {
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

  return { packages, workspaceCount, source: 'js-yaml' };
}

/**
 * Get packages from pnpm lockfile - tries official parser first, falls back to js-yaml
 * @param {string} content - Lockfile content
 * @param {string} filepath - Path to lockfile
 * @param {CompareOptions} [options] - Options
 * @returns {Promise<PackagesResult>}
 */
async function getPackagesFromPnpm(content, filepath, options = {}) {
  // Try official pnpm parser first
  const officialResult = await getPackagesFromPnpmOfficial(content, filepath, options);
  if (officialResult) return officialResult;

  // Fall back to js-yaml
  return getPackagesFromPnpmYaml(content);
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
      comparisonResult = await getPackagesFromPnpm(content, filepath, options);
      break;
    default:
      return { type, identical: null, flatlockCount: flatlockSet.size };
  }

  const { packages: comparisonSet, workspaceCount, source } = comparisonResult;
  const onlyInFlatlock = new Set([...flatlockSet].filter(x => !comparisonSet.has(x)));
  const onlyInComparison = new Set([...comparisonSet].filter(x => !flatlockSet.has(x)));
  const identical = onlyInFlatlock.size === 0 && onlyInComparison.size === 0;

  return {
    type,
    source,
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

/**
 * Check which optional comparison parsers are available
 * @returns {Promise<{ arborist: boolean, cyclonedx: boolean, pnpmLockfileFs: boolean }>}
 */
export async function getAvailableParsers() {
  const [arborist, pnpmLockfileFs] = await Promise.all([
    loadArborist(),
    loadPnpmLockfileFs()
  ]);
  const cyclonedx = loadCycloneDxCliPath();

  return {
    arborist: !!arborist,
    cyclonedx: !!cyclonedx,
    pnpmLockfileFs: !!pnpmLockfileFs
  };
}
