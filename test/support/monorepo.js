/**
 * Shared monorepo test utilities
 *
 * Security: All install commands run with ignore-scripts=true
 * to prevent sha1-hulud supply chain attack vectors.
 *
 * Ground truth: We get the reference SBOM by installing the published
 * package with npm, not by running cyclonedx on the monorepo. This works
 * for ANY package manager's monorepo because the published package is
 * always installable via npm.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fg from 'fast-glob';
import { x } from 'tinyexec';
import { FlatlockSet } from '../../src/set.js';

/**
 * Clone a repository to a temp directory
 * @param {string} repo - GitHub repo (owner/repo)
 * @param {string} branch - Branch to clone
 * @returns {Promise<string>} Path to cloned repo
 */
export async function cloneRepo(repo, branch = 'main') {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-test-'));

  const result = await x('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    branch,
    `https://github.com/${repo}.git`,
    tmpDir
  ]);

  if (result.exitCode !== 0) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`git clone failed: ${result.stderr}`);
  }

  return tmpDir;
}

/**
 * Write security-focused config files to prevent install script attacks
 * @param {string} dir - Directory to write configs
 * @param {'npm' | 'pnpm' | 'yarn'} packageManager
 */
export async function writeSecurityConfig(dir, packageManager) {
  // All package managers: .npmrc with ignore-scripts
  await writeFile(join(dir, '.npmrc'), 'ignore-scripts=true\naudit=false\nfund=false\n');

  if (packageManager === 'pnpm') {
    // pnpm also respects .npmrc, but be explicit
    await writeFile(join(dir, '.pnpmrc'), 'ignore-scripts=true\n');
  }

  if (packageManager === 'yarn') {
    // Yarn berry uses .yarnrc.yml
    await writeFile(join(dir, '.yarnrc.yml'), 'enableScripts: false\nenableTelemetry: false\n');
  }
}

/**
 * Run CycloneDX for a workspace and parse results
 * @param {string} dir - Project directory
 * @param {string} workspace - Workspace path
 * @param {'npm' | 'pnpm' | 'yarn'} packageManager
 * @returns {Promise<Set<string>>} Set of name@version strings
 */
export async function getCycloneDXPackages(dir, workspace, _packageManager) {
  const args = [
    '@cyclonedx/cyclonedx-npm',
    '-w',
    workspace,
    '--output-format',
    'JSON',
    '--flatten-components',
    '--omit',
    'dev'
  ];

  const result = await x('npx', args, {
    nodeOptions: { cwd: dir }
  });

  if (result.exitCode !== 0) {
    throw new Error(`CycloneDX failed: ${result.stderr}`);
  }

  // Get workspace package.json to filter out self
  const workspacePkgPath = join(dir, workspace, 'package.json');
  const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));
  const selfKey = `${workspacePkg.name}@${workspacePkg.version}`;

  const sbom = JSON.parse(result.stdout);
  const packages = new Set();

  for (const component of sbom.components || []) {
    if (component.type === 'library' && component.name && component.version) {
      // CycloneDX splits scoped packages: group="@types", name="node"
      const fullName = component.group ? `${component.group}/${component.name}` : component.name;
      const key = `${fullName}@${component.version}`;

      // Exclude self (we want dependencies, not self)
      if (key !== selfKey) {
        packages.add(key);
      }
    }
  }

  return packages;
}

/**
 * Run flatlock dependenciesOf for a workspace
 * @param {string} dir - Project directory
 * @param {string} workspace - Workspace path
 * @param {string} lockfileName - Lockfile name
 * @returns {Promise<Set<string>>} Set of name@version strings
 */
export async function getFlatlockPackages(dir, workspace, lockfileName) {
  const lockfilePath = join(dir, lockfileName);
  const workspacePkgPath = join(dir, workspace, 'package.json');

  const lockfile = await FlatlockSet.fromPath(lockfilePath);
  const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));

  // Build workspace packages map for all package managers
  let workspacePackages;
  if (lockfileName === 'pnpm-lock.yaml') {
    workspacePackages = await buildPnpmWorkspacePackagesMap(dir, lockfilePath);
  } else if (lockfileName === 'yarn.lock') {
    workspacePackages = await buildYarnWorkspacePackagesMap(dir, lockfilePath);
  } else if (lockfileName === 'package-lock.json') {
    workspacePackages = await buildNpmWorkspacePackagesMap(dir, lockfilePath);
  }

  const deps = await lockfile.dependenciesOf(workspacePkg, {
    workspacePath: workspace,
    dev: false,
    peer: true, // npm 7+ auto-installs peerDependencies, so ground truth includes them
    workspacePackages
  });

  const packages = new Set();
  for (const dep of deps) {
    packages.add(`${dep.name}@${dep.version}`);
  }

  return packages;
}

/**
 * Build a map of workspace path → { name, version } from pnpm lockfile
 * @param {string} dir - Project directory
 * @param {string} lockfilePath - Path to pnpm-lock.yaml
 * @returns {Promise<Record<string, {name: string, version: string}>>}
 */
async function buildPnpmWorkspacePackagesMap(dir, lockfilePath) {
  const yaml = (await import('js-yaml')).default;
  const content = await readFile(lockfilePath, 'utf8');
  const lockfile = yaml.load(content);

  const workspacePackages = {};
  const skipped = [];
  const importers = lockfile.importers || {};

  for (const wsPath of Object.keys(importers)) {
    if (wsPath === '.') continue; // Skip root

    try {
      const pkgPath = join(dir, wsPath, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      workspacePackages[wsPath] = {
        name: pkg.name,
        version: pkg.version
      };
    } catch (err) {
      skipped.push({ path: wsPath, reason: err.message });
    }
  }

  if (skipped.length > 0) {
    console.warn(`    WARNING: Skipped ${skipped.length} pnpm workspace(s):`);
    for (const { path, reason } of skipped.slice(0, 5)) {
      console.warn(`      - ${path}: ${reason}`);
    }
    if (skipped.length > 5) {
      console.warn(`      ... and ${skipped.length - 5} more`);
    }
  }

  return workspacePackages;
}

/**
 * Build a map of workspace path → { name, version } from npm lockfile
 * npm workspace packages have entries like "workspaces/arborist" with version.
 * Name may be in lockfile entry or need to be read from workspace package.json
 * @param {string} dir - Project directory
 * @param {string} lockfilePath - Path to package-lock.json
 * @returns {Promise<Record<string, {name: string, version: string}>>}
 */
async function buildNpmWorkspacePackagesMap(dir, lockfilePath) {
  const content = await readFile(lockfilePath, 'utf8');
  const lockfile = JSON.parse(content);

  const workspacePackages = {};
  const skipped = [];
  const packages = lockfile.packages || {};

  // Find all workspace entries (paths without node_modules that have version)
  for (const [key, entry] of Object.entries(packages)) {
    // Skip root and node_modules entries (those are installed packages, not workspaces)
    if (key === '' || key.includes('node_modules')) continue;

    // Workspace entries without version are suspicious - track them
    if (!entry.version) {
      skipped.push({ path: key, reason: 'no version in lockfile entry' });
      continue;
    }

    // This is a workspace package definition
    let name = entry.name;

    // If name not in lockfile, read from workspace package.json
    if (!name) {
      try {
        const pkgPath = join(dir, key, 'package.json');
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
        name = pkg.name;
      } catch (err) {
        skipped.push({ path: key, reason: err.message });
        continue;
      }
    }

    if (name) {
      workspacePackages[key] = {
        name,
        version: entry.version
      };
    } else {
      skipped.push({ path: key, reason: 'no name in lockfile or package.json' });
    }
  }

  if (skipped.length > 0) {
    console.warn(`    WARNING: Skipped ${skipped.length} npm workspace(s):`);
    for (const { path, reason } of skipped.slice(0, 5)) {
      console.warn(`      - ${path}: ${reason}`);
    }
    if (skipped.length > 5) {
      console.warn(`      ... and ${skipped.length - 5} more`);
    }
  }

  return workspacePackages;
}

/**
 * Build a map of workspace path → { name, version } from yarn lockfile
 * Handles both yarn berry (workspace: entries) and yarn classic (workspaces in package.json)
 * @param {string} dir - Project directory
 * @param {string} lockfilePath - Path to yarn.lock
 * @returns {Promise<Record<string, {name: string, version: string}>>}
 */
async function buildYarnWorkspacePackagesMap(dir, lockfilePath) {
  const { parseSyml } = await import('@yarnpkg/parsers');
  const content = await readFile(lockfilePath, 'utf8');
  const lockfile = parseSyml(content);

  const workspacePackages = {};
  const skipped = [];

  // First try yarn berry format: "@babel/parser@workspace:packages/babel-parser"
  for (const key of Object.keys(lockfile)) {
    if (key === '__metadata') continue;

    const match = key.match(/^(.+)@workspace:(.+)$/);
    if (match) {
      const [, _name, wsPath] = match;
      if (wsPath === '.') continue;

      try {
        const pkgPath = join(dir, wsPath, 'package.json');
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
        workspacePackages[wsPath] = {
          name: pkg.name,
          version: pkg.version
        };
      } catch (err) {
        skipped.push({ path: wsPath, reason: err.message });
      }
    }
  }

  // If no workspace entries found, try yarn classic format (workspaces in package.json)
  if (Object.keys(workspacePackages).length === 0) {
    try {
      const rootPkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      const workspacePatterns = rootPkg.workspaces?.packages || rootPkg.workspaces || [];

      if (Array.isArray(workspacePatterns)) {
        // Resolve workspace patterns to actual paths
        const paths = await fg(workspacePatterns, { cwd: dir, onlyDirectories: true });

        for (const wsPath of paths) {
          try {
            const pkgPath = join(dir, wsPath, 'package.json');
            const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
            workspacePackages[wsPath] = {
              name: pkg.name,
              version: pkg.version
            };
          } catch (err) {
            skipped.push({ path: wsPath, reason: err.message });
          }
        }
      }
    } catch (err) {
      // Root package.json issue is a hard failure for yarn classic detection
      console.warn(
        `    WARNING: Could not read root package.json for yarn classic workspaces: ${err.message}`
      );
    }
  }

  if (skipped.length > 0) {
    console.warn(`    WARNING: Skipped ${skipped.length} yarn workspace(s):`);
    for (const { path, reason } of skipped.slice(0, 5)) {
      console.warn(`      - ${path}: ${reason}`);
    }
    if (skipped.length > 5) {
      console.warn(`      ... and ${skipped.length - 5} more`);
    }
  }

  return workspacePackages;
}

/**
 * Compute set difference: a - b
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {Set<string>}
 */
export function difference(a, b) {
  return new Set([...a].filter(x => !b.has(x)));
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

/**
 * Full test flow for a workspace (npm only - uses CycloneDX -w)
 * @param {Object} options
 * @param {string} options.repo - GitHub repo
 * @param {string} options.branch - Branch
 * @param {string} options.workspace - Workspace path
 * @param {'npm' | 'pnpm' | 'yarn'} options.packageManager
 * @param {string} options.lockfileName - Lockfile name
 * @param {Function} options.install - Install function
 */
export async function testWorkspace(options) {
  const { repo, branch, workspace, packageManager, lockfileName, install } = options;
  let tmpDir;

  try {
    console.log(`    Cloning ${repo}@${branch}...`);
    tmpDir = await cloneRepo(repo, branch);

    console.log(`    Writing security config...`);
    await writeSecurityConfig(tmpDir, packageManager);

    console.log(`    Running ${packageManager} install...`);
    await install(tmpDir);

    console.log(`    Running CycloneDX for ${workspace}...`);
    const cyclonedxSet = await getCycloneDXPackages(tmpDir, workspace, packageManager);

    console.log(`    Running flatlock dependenciesOf...`);
    const flatlockSet = await getFlatlockPackages(tmpDir, workspace, lockfileName);

    return { cyclonedxSet, flatlockSet, tmpDir };
  } catch (err) {
    if (tmpDir) await cleanup(tmpDir);
    throw err;
  }
}

/**
 * Get ground truth SBOM by installing published package fresh
 * Works for ANY package manager because published packages install via npm
 * @param {string} packageName - Package name
 * @param {string} version - Version to install
 * @returns {Promise<{names: Set<string>, packages: Set<string>}>}
 */
export async function getGroundTruth(packageName, version) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-ground-truth-'));

  try {
    // Create package.json with sole dependency
    const pkg = {
      name: 'ground-truth-test',
      version: '1.0.0',
      private: true,
      dependencies: { [packageName]: version }
    };
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));
    await writeFile(join(tmpDir, '.npmrc'), 'ignore-scripts=true\naudit=false\nfund=false\n');

    // npm install
    const installResult = await x('npm', ['install'], { nodeOptions: { cwd: tmpDir } });
    if (installResult.exitCode !== 0) {
      throw new Error(`npm install failed: ${installResult.stderr}`);
    }

    // CycloneDX
    const cdxResult = await x(
      'npx',
      [
        '@cyclonedx/cyclonedx-npm',
        '--output-format',
        'JSON',
        '--flatten-components',
        '--omit',
        'dev'
      ],
      { nodeOptions: { cwd: tmpDir } }
    );

    if (cdxResult.exitCode !== 0) {
      throw new Error(`CycloneDX failed: ${cdxResult.stderr}`);
    }

    const sbom = JSON.parse(cdxResult.stdout);
    const names = new Set();
    const packages = new Set();

    for (const c of sbom.components || []) {
      if (c.type === 'library' && c.name && c.version) {
        const fullName = c.group ? `${c.group}/${c.name}` : c.name;
        names.add(fullName);
        packages.add(`${fullName}@${c.version}`);
      }
    }

    return { names, packages };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Assert ground truth for a workspace
 * Shared implementation used by all monorepo tests across all package managers.
 *
 * @param {Object} options
 * @param {string} options.repo - GitHub repo (owner/repo)
 * @param {string} options.branch - Branch to test
 * @param {string} options.workspace - Workspace path within repo
 * @param {string} options.lockfileName - Lockfile name (package-lock.json, pnpm-lock.yaml, yarn.lock)
 * @param {Set<string>} [options.knownVersionDifferences] - Package names expected to differ due to version drift
 * @returns {Promise<void>}
 */
export async function assertGroundTruth(options) {
  const { repo, branch, workspace, lockfileName, knownVersionDifferences = new Set() } = options;
  let tmpDir;

  try {
    const result = await testWorkspaceGroundTruth({ repo, branch, workspace, lockfileName });
    tmpDir = result.tmpDir;
    const { groundTruthNames, flatlockNames } = result;

    console.log(`    ground truth: ${groundTruthNames.size} packages`);
    console.log(`    flatlock:     ${flatlockNames.size} packages`);

    const missing = [...groundTruthNames].filter(n => !flatlockNames.has(n));
    const extra = [...flatlockNames].filter(n => !groundTruthNames.has(n));
    const unexpectedMissing = missing.filter(n => !knownVersionDifferences.has(n));

    console.log(
      `    missing:      ${missing.length}${knownVersionDifferences.size > 0 ? ` (${unexpectedMissing.length} unexpected)` : ''}`
    );
    console.log(`    extra:        ${extra.length}`);

    if (unexpectedMissing.length > 0) {
      console.log(`    UNEXPECTED MISSING: ${unexpectedMissing.slice(0, 10).join(', ')}`);
    }
    if (extra.length > 0) {
      console.log(`    EXTRA: ${extra.slice(0, 10).join(', ')}`);
    }

    const assert = await import('node:assert');
    assert.default.strictEqual(
      unexpectedMissing.length,
      0,
      `flatlock missing ${unexpectedMissing.length} unexpected package names: ${unexpectedMissing.join(', ')}`
    );
  } finally {
    if (tmpDir) await cleanup(tmpDir);
  }
}

/**
 * Test workspace using ground truth (for pnpm/yarn where CycloneDX -w doesn't work)
 * Compares package NAMES only since lockfile pins different versions than npm resolves
 *
 * Note: The top-level package itself is excluded from comparison since we're
 * comparing dependencies OF the package, not the package itself.
 */
export async function testWorkspaceGroundTruth(options) {
  const { repo, branch, workspace, lockfileName } = options;
  let tmpDir;

  try {
    console.log(`    Cloning ${repo}@${branch}...`);
    tmpDir = await cloneRepo(repo, branch);

    // Get package info from workspace
    const workspacePkgPath = join(tmpDir, workspace, 'package.json');
    const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf8'));
    const { name, version } = workspacePkg;

    console.log(`    Getting ground truth for ${name}@${version}...`);
    const groundTruth = await getGroundTruth(name, version);

    // Exclude the top-level package itself from ground truth
    // We're comparing dependencies OF the package, not the package itself
    groundTruth.names.delete(name);

    console.log(`    Running flatlock dependenciesOf...`);
    const flatlockSet = await getFlatlockPackages(tmpDir, workspace, lockfileName);
    const flatlockNames = new Set([...flatlockSet].map(p => p.split('@').slice(0, -1).join('@')));

    // Exclude the top-level package from flatlock too
    flatlockNames.delete(name);

    return {
      groundTruthNames: groundTruth.names,
      groundTruthPackages: groundTruth.packages,
      flatlockSet,
      flatlockNames,
      tmpDir
    };
  } catch (err) {
    if (tmpDir) await cleanup(tmpDir);
    throw err;
  }
}
