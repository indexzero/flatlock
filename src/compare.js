import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yarnLockfile from '@yarnpkg/lockfile';
import { parseSyml } from '@yarnpkg/parsers';
import yaml from 'js-yaml';
import { fromPath, detectType, Type } from './index.js';
import { parseYarnClassicKey, parseYarnBerryKey } from './parsers/index.js';
import { parseSpec as parsePnpmSpec } from './parsers/pnpm.js';

// Arborist is lazy-loaded because it's a devDependency (comparison testing only)
let Arborist;

async function loadArborist() {
  if (!Arborist) {
    const mod = await import('@npmcli/arborist');
    Arborist = mod.default;
  }
  return Arborist;
}

/**
 * Get packages from npm lockfile using Arborist (ground truth)
 */
async function getPackagesFromNpm(content, filepath, options = {}) {
  const Arb = await loadArborist();

  // Arborist needs a directory with package-lock.json
  const tmpDir = options.tmpDir || await mkdtemp(join(tmpdir(), 'flatlock-cmp-'));
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

    return { packages, workspaceCount };
  } finally {
    if (!options.tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Get packages from yarn classic lockfile
 */
async function getPackagesFromYarnClassic(content) {
  const parse = yarnLockfile.parse || yarnLockfile.default?.parse;
  const parsed = parse(content);

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
 */
async function getPackagesFromYarnBerry(content) {
  const parsed = parseSyml(content);

  const packages = new Set();
  let workspaceCount = 0;

  for (const [key, value] of Object.entries(parsed)) {
    if (key === '__metadata') continue;

    // Skip workspace/link entries - flatlock only cares about external dependencies
    const resolution = value.resolution || '';
    if (resolution.startsWith('workspace:') ||
        resolution.startsWith('portal:') ||
        resolution.startsWith('link:')) {
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
 */
async function getPackagesFromPnpm(content) {
  const parsed = yaml.load(content);

  const packages = new Set();
  let workspaceCount = 0;
  const pkgs = parsed.packages || {};

  for (const [key, value] of Object.entries(pkgs)) {
    // Skip link/file entries - flatlock only cares about external dependencies
    // Keys can be: link:path, file:path, or @pkg@file:path
    if (key.startsWith('link:') || key.startsWith('file:') ||
        key.includes('@link:') || key.includes('@file:')) {
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
 * @param {Object} options - Options
 * @param {string} options.tmpDir - Temp directory for Arborist (npm only)
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
 * @param {Object} options
 * @returns {AsyncGenerator<ComparisonResult>}
 */
export async function* compareAll(filepaths, options = {}) {
  for (const filepath of filepaths) {
    yield { filepath, ...(await compare(filepath, options)) };
  }
}
