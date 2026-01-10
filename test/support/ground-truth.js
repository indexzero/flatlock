/**
 * Ground truth SBOM generation
 *
 * The vessel: cyclonedx-npm -w only works with npm workspaces
 * The need: ground truth SBOM for any package
 * The way: npm install the published package, run cdxgen on that
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x } from 'tinyexec';

/**
 * Get ground truth SBOM for a package by installing it fresh
 *
 * @param {string} packageName - Package name (e.g., 'jest', '@babel/core')
 * @param {string} version - Version to install
 * @returns {Promise<Set<string>>} Set of name@version strings
 */
export async function getGroundTruthSBOM(packageName, version) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flatlock-ground-truth-'));

  try {
    // 1. Create package.json with sole dependency
    const pkg = {
      name: 'ground-truth-test',
      version: '1.0.0',
      private: true,
      dependencies: {
        [packageName]: version
      }
    };
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

    // 2. Write security config
    await writeFile(join(tmpDir, '.npmrc'), 'ignore-scripts=true\naudit=false\nfund=false\n');

    // 3. npm install
    const installResult = await x('npm', ['install'], {
      nodeOptions: { cwd: tmpDir }
    });

    if (installResult.exitCode !== 0) {
      throw new Error(`npm install failed: ${installResult.stderr}`);
    }

    // 4. Run cdxgen (CycloneDX generator)
    const sbomPath = join(tmpDir, 'sbom.json');
    const cdxResult = await x(
      'npx',
      [
        '@cyclonedx/cdxgen',
        '--required-only',
        '-o',
        sbomPath
      ],
      {
        nodeOptions: { cwd: tmpDir }
      }
    );

    if (cdxResult.exitCode !== 0) {
      throw new Error(`cdxgen failed: ${cdxResult.stderr}`);
    }

    // 5. Parse SBOM
    const sbom = JSON.parse(await readFile(sbomPath, 'utf8'));
    const packages = new Set();

    for (const component of sbom.components || []) {
      if (component.type === 'library' && component.name && component.version) {
        const fullName = component.group ? `${component.group}/${component.name}` : component.name;
        packages.add(`${fullName}@${component.version}`);
      }
    }

    return packages;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Get package info from a workspace package.json
 *
 * @param {string} repoDir - Repository directory
 * @param {string} workspace - Workspace path
 * @returns {Promise<{name: string, version: string}>}
 */
export async function getWorkspacePackageInfo(repoDir, workspace) {
  const pkgPath = join(repoDir, workspace, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  return { name: pkg.name, version: pkg.version };
}
