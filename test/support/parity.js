/**
 * Parser parity testing utilities
 *
 * Three-way verification: flatlock vs CycloneDX on same lockfile
 * Goal: If both parse the same lockfile, results should be identical.
 * Any difference is a parser bug in one or the other.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x } from 'tinyexec';
import { FlatlockSet } from '../../src/set.js';

/**
 * Platform-specific package name patterns
 * These are optionalDependencies that only install on specific platforms
 */
const PLATFORM_PATTERNS = [
  '-darwin-',
  '-linux-',
  '-win32-',
  '-android-',
  '-freebsd-',
  '-openbsd-',
  '-sunos-'
];

const PLATFORM_SPECIFIC_PACKAGES = new Set([
  'fsevents' // macOS only
]);

/**
 * Check if a package name is platform-specific
 * @param {string} name
 * @returns {boolean}
 */
export function isPlatformSpecific(name) {
  if (PLATFORM_SPECIFIC_PACKAGES.has(name)) return true;
  return PLATFORM_PATTERNS.some(pattern => name.includes(pattern));
}

/**
 * Set difference: a - b
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {Set<string>}
 */
function difference(a, b) {
  return new Set([...a].filter(x => !b.has(x)));
}

/**
 * Extract package name from name@version string
 * @param {string} pkgString
 * @returns {string}
 */
function extractName(pkgString) {
  // Handle scoped packages: @scope/name@version
  const atIndex = pkgString.lastIndexOf('@');
  if (atIndex <= 0) return pkgString;
  return pkgString.substring(0, atIndex);
}

/**
 * Create temp directory and install a package
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<string>} Path to temp directory
 */
async function setupAndInstall(packageName, version) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-parity-'));

  // Create package.json
  const pkg = {
    name: 'parity-test',
    version: '1.0.0',
    private: true,
    dependencies: {
      [packageName]: version
    }
  };
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // Security config
  await writeFile(join(tmpDir, '.npmrc'), 'ignore-scripts=true\naudit=false\nfund=false\n');

  // npm install
  const result = await x('npm', ['install'], {
    nodeOptions: { cwd: tmpDir }
  });

  if (result.exitCode !== 0) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`npm install failed: ${result.stderr}`);
  }

  return tmpDir;
}

/**
 * Run CycloneDX on a directory
 * @param {string} dir
 * @param {{ lockfileOnly?: boolean }} options
 * @returns {Promise<Set<string>>} Set of name@version strings
 */
async function runCycloneDX(dir, { lockfileOnly = false } = {}) {
  const args = [
    '@cyclonedx/cyclonedx-npm',
    '--output-format',
    'JSON',
    '--flatten-components',
    '--omit',
    'dev'
  ];

  if (lockfileOnly) {
    args.push('--package-lock-only');
  }

  const result = await x('npx', args, {
    nodeOptions: { cwd: dir }
  });

  if (result.exitCode !== 0) {
    throw new Error(`CycloneDX failed: ${result.stderr}`);
  }

  const sbom = JSON.parse(result.stdout);
  const packages = new Set();

  // Get the root package name to exclude it
  const rootPkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const rootName = rootPkg.name;

  for (const component of sbom.components || []) {
    if (component.type === 'library' && component.name && component.version) {
      const fullName = component.group ? `${component.group}/${component.name}` : component.name;

      // Exclude root package
      if (fullName === rootName) continue;

      packages.add(`${fullName}@${component.version}`);
    }
  }

  return packages;
}

/**
 * Run Flatlock on a directory's package-lock.json
 * @param {string} dir
 * @returns {Promise<Set<string>>} Set of name@version strings
 */
async function runFlatlock(dir) {
  const lockfilePath = join(dir, 'package-lock.json');
  const lockfile = await FlatlockSet.fromPath(lockfilePath);

  const packages = new Set();
  for (const dep of lockfile) {
    packages.add(`${dep.name}@${dep.version}`);
  }

  return packages;
}

/**
 * Compare two sets and return detailed results
 * @param {Set<string>} cyclonedx
 * @param {Set<string>} flatlock
 * @param {{ filterPlatformSpecific?: boolean }} options
 * @returns {Object}
 */
function compareResults(cyclonedx, flatlock, { filterPlatformSpecific = false } = {}) {
  const onlyInCycloneDX = difference(cyclonedx, flatlock);
  const onlyInFlatlock = difference(flatlock, cyclonedx);

  // Filter platform-specific packages if requested
  let unexpectedInCycloneDX = onlyInCycloneDX;
  let unexpectedInFlatlock = onlyInFlatlock;

  if (filterPlatformSpecific) {
    unexpectedInCycloneDX = new Set(
      [...onlyInCycloneDX].filter(p => !isPlatformSpecific(extractName(p)))
    );
    unexpectedInFlatlock = new Set(
      [...onlyInFlatlock].filter(p => !isPlatformSpecific(extractName(p)))
    );
  }

  return {
    equal: unexpectedInCycloneDX.size === 0 && unexpectedInFlatlock.size === 0,
    cyclonedx: {
      total: cyclonedx.size,
      onlyHere: onlyInCycloneDX.size,
      unexpected: unexpectedInCycloneDX.size,
      packages: [...unexpectedInCycloneDX].sort()
    },
    flatlock: {
      total: flatlock.size,
      onlyHere: onlyInFlatlock.size,
      unexpected: unexpectedInFlatlock.size,
      packages: [...unexpectedInFlatlock].sort()
    }
  };
}

/**
 * Get parser parity results for a package
 * Compares flatlock vs CycloneDX on the same package-lock.json
 *
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<Object>}
 */
export async function getParityResults(packageName, version) {
  const tmpDir = await setupAndInstall(packageName, version);

  try {
    // Run both on the same lockfile
    const [cyclonedxLockfile, cyclonedxNodeModules, flatlock] = await Promise.all([
      runCycloneDX(tmpDir, { lockfileOnly: true }),
      runCycloneDX(tmpDir, { lockfileOnly: false }),
      runFlatlock(tmpDir)
    ]);

    // Parser parity: both parsing lockfile
    const lockfileComparison = compareResults(cyclonedxLockfile, flatlock);

    // Installation parity: lockfile vs what's installed
    const installComparison = compareResults(cyclonedxNodeModules, flatlock, {
      filterPlatformSpecific: true
    });

    return {
      package: `${packageName}@${version}`,
      lockfileParity: lockfileComparison,
      installParity: installComparison,
      counts: {
        cyclonedxLockfile: cyclonedxLockfile.size,
        cyclonedxNodeModules: cyclonedxNodeModules.size,
        flatlock: flatlock.size
      }
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Get three-way comparison for monorepo testing
 *
 * @param {string} monorepoLockfilePath - Path to monorepo lockfile
 * @param {Object} workspacePkg - Workspace package.json
 * @param {string} workspacePath - Workspace path in monorepo
 * @param {Object} workspacePackages - Map of workspace packages
 * @returns {Promise<Object>}
 */
export async function getThreeWayComparison(
  monorepoLockfilePath,
  workspacePkg,
  workspacePath,
  workspacePackages
) {
  // Method 1: Parse monorepo lockfile
  const monorepoLockfile = await FlatlockSet.fromPath(monorepoLockfilePath);
  const monorepoDeps = monorepoLockfile.dependenciesOf(workspacePkg, {
    workspacePath,
    dev: false,
    peer: true,
    workspacePackages
  });
  const _monorepoSet = new Set([...monorepoDeps].map(d => `${d.name}@${d.version}`));
  const monorepoNames = new Set([...monorepoDeps].map(d => d.name));

  // Method 2 & 3: Fresh install
  const { name, version } = workspacePkg;
  const tmpDir = await setupAndInstall(name, version);

  try {
    const [cyclonedx, freshFlatlock] = await Promise.all([
      runCycloneDX(tmpDir, { lockfileOnly: false }),
      runFlatlock(tmpDir)
    ]);

    // Extract names for comparison (versions may differ)
    const cyclonedxNames = new Set([...cyclonedx].map(extractName));
    const freshFlatlockNames = new Set([...freshFlatlock].map(extractName));

    // Exclude the package itself
    monorepoNames.delete(name);
    cyclonedxNames.delete(name);
    freshFlatlockNames.delete(name);

    return {
      package: `${name}@${version}`,
      counts: {
        monorepo: monorepoNames.size,
        cyclonedx: cyclonedxNames.size,
        freshFlatlock: freshFlatlockNames.size
      },
      // Parser parity: fresh CycloneDX vs fresh Flatlock
      parserParity: {
        equal:
          [...difference(cyclonedxNames, freshFlatlockNames)].length === 0 &&
          [...difference(freshFlatlockNames, cyclonedxNames)].length === 0,
        onlyInCycloneDX: [...difference(cyclonedxNames, freshFlatlockNames)].filter(
          n => !isPlatformSpecific(n)
        ),
        onlyInFlatlock: [...difference(freshFlatlockNames, cyclonedxNames)].filter(
          n => !isPlatformSpecific(n)
        )
      },
      // Monorepo vs fresh: what's missing from monorepo
      monorepoVsFresh: {
        missingFromMonorepo: [...difference(cyclonedxNames, monorepoNames)].filter(
          n => !isPlatformSpecific(n)
        ),
        extraInMonorepo: [...difference(monorepoNames, cyclonedxNames)]
      }
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Clean up temp directory
 * @param {string} dir
 */
export async function cleanup(dir) {
  if (dir?.startsWith(tmpdir())) {
    await rm(dir, { recursive: true, force: true });
  }
}
