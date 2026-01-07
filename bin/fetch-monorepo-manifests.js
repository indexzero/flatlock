#!/usr/bin/env node

/**
 * fetch-monorepo-manifests - Fetch monorepo test fixtures from source git repos
 *
 * Fetches lockfiles and workspace package.json files from GitHub repositories
 * to create reproducible test fixtures for monorepo SBOM testing.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jack } from 'jackspeak';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = join(__dirname, '../test/monorepos/fixtures');

// Lockfile detection patterns
const LOCKFILE_PATTERNS = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  'yarn-berry': 'yarn.lock',
  'yarn-classic': 'yarn.lock'
};

/**
 * Parse CLI arguments using jackspeak
 */
function parseArgs() {
  const j = jack({
    envPrefix: 'FLATLOCK',
    usage: 'fetch-monorepo-manifests <owner/repo> [options]'
  })
    .opt({
      branch: {
        short: 'b',
        description: 'Branch or tag to fetch from',
        default: 'main'
      },
      type: {
        short: 't',
        description: 'Package manager type (npm, pnpm, yarn-berry, yarn-classic)',
        validOptions: ['npm', 'pnpm', 'yarn-berry', 'yarn-classic']
      },
      output: {
        short: 'o',
        description: 'Output directory for fixtures',
        default: DEFAULT_OUTPUT_DIR
      }
    })
    .optList({
      workspace: {
        short: 'w',
        description: 'Workspace paths to fetch (can specify multiple)'
      }
    })
    .flag({
      help: {
        short: 'h',
        description: 'Show this help message'
      },
      verbose: {
        short: 'v',
        description: 'Show verbose output'
      },
      force: {
        short: 'f',
        description: 'Overwrite existing fixtures'
      },
      'dry-run': {
        short: 'n',
        description: 'Show what would be fetched without writing files'
      }
    });

  const { values, positionals } = j.parse();

  if (values.help) {
    console.log(j.usage());
    console.log(`
${chalk.bold('Description:')}
  Fetch monorepo test fixtures from GitHub repositories.
  Downloads lockfiles and workspace package.json files to create
  reproducible test fixtures for workspace SBOM testing.

${chalk.bold('Examples:')}
  ${chalk.gray('# Fetch socket.io npm monorepo with specific workspaces')}
  $ fetch-monorepo-manifests socketio/socket.io -t npm -w packages/socket.io -w packages/engine.io

  ${chalk.gray('# Fetch Vue.js pnpm monorepo')}
  $ fetch-monorepo-manifests vuejs/core -t pnpm -b main

  ${chalk.gray('# Dry run to see what would be fetched')}
  $ fetch-monorepo-manifests babel/babel -t yarn-berry --dry-run
`);
    process.exit(0);
  }

  if (positionals.length === 0) {
    console.error(chalk.red('Error: Repository argument required (e.g., socketio/socket.io)'));
    console.log('\n' + j.usage());
    process.exit(1);
  }

  const repo = positionals[0];
  if (!repo.includes('/')) {
    console.error(chalk.red(`Error: Invalid repository format "${repo}". Expected owner/repo`));
    process.exit(1);
  }

  return { ...values, repo };
}

/**
 * Fetch a file from GitHub raw content
 * @param {string} repo - Repository (owner/repo)
 * @param {string} branch - Branch or tag
 * @param {string} path - File path in repo
 * @returns {Promise<string|null>} File content or null if not found
 */
async function fetchGitHubFile(repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Detect package manager type from lockfile presence
 */
async function detectType(repo, branch) {
  for (const [type, lockfile] of Object.entries(LOCKFILE_PATTERNS)) {
    const content = await fetchGitHubFile(repo, branch, lockfile);
    if (content !== null) {
      // Distinguish yarn berry from classic
      if (type === 'yarn-berry' && !content.includes('__metadata:')) {
        return 'yarn-classic';
      }
      return type;
    }
  }
  return null;
}

/**
 * Extract workspaces from package.json
 */
function extractWorkspaces(packageJson) {
  const pkg = JSON.parse(packageJson);
  let workspaces = pkg.workspaces || [];

  // Handle yarn-style workspaces object
  if (workspaces.packages) {
    workspaces = workspaces.packages;
  }

  return workspaces;
}

/**
 * Expand glob patterns in workspace paths
 * For simplicity, we fetch the lockfile and extract actual workspace paths from it
 */
async function resolveWorkspaces(repo, branch, type, lockfileContent, rootPkgContent) {
  const workspaces = [];

  if (type === 'npm') {
    // Parse lockfile to find workspace paths
    const lockfile = JSON.parse(lockfileContent);
    const packages = lockfile.packages || {};

    for (const [path, pkg] of Object.entries(packages)) {
      // Workspace definitions are paths without node_modules
      if (path && !path.includes('node_modules') && path !== '') {
        workspaces.push(path);
      }
    }
  } else if (type === 'pnpm') {
    // pnpm uses importers in lockfile
    const yaml = (await import('js-yaml')).default;
    const lockfile = yaml.load(lockfileContent);
    const importers = lockfile.importers || {};

    for (const path of Object.keys(importers)) {
      if (path !== '.') {
        workspaces.push(path);
      }
    }
  } else if (type === 'yarn-berry' || type === 'yarn-classic') {
    // Yarn uses workspaces field in package.json
    // We need to resolve glob patterns
    const wsPatterns = extractWorkspaces(rootPkgContent);

    // For now, we can't easily resolve globs without filesystem access
    // Return the patterns and let user specify explicitly
    return wsPatterns;
  }

  return workspaces;
}

/**
 * Create a minimal package.json for a workspace
 */
function createMinimalPackageJson(fullPkg) {
  const pkg = JSON.parse(fullPkg);
  const minimal = {
    name: pkg.name,
    version: pkg.version
  };

  if (pkg.description) minimal.description = pkg.description;
  if (pkg.dependencies) minimal.dependencies = pkg.dependencies;
  if (pkg.devDependencies) minimal.devDependencies = pkg.devDependencies;
  if (pkg.peerDependencies) minimal.peerDependencies = pkg.peerDependencies;
  if (pkg.optionalDependencies) minimal.optionalDependencies = pkg.optionalDependencies;

  return JSON.stringify(minimal, null, 2);
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  const { repo, branch, output, verbose, force } = args;
  let { type, workspace: requestedWorkspaces } = args;
  const dryRun = args['dry-run'];

  console.log(chalk.bold('\n📦 fetch-monorepo-manifests\n'));
  console.log(chalk.gray(`Repository: ${chalk.white(repo)}`));
  console.log(chalk.gray(`Branch:     ${chalk.white(branch)}`));

  // Auto-detect type if not specified
  if (!type) {
    console.log(chalk.gray('Type:       ') + chalk.yellow('detecting...'));
    type = await detectType(repo, branch);
    if (!type) {
      console.error(chalk.red('\n❌ Could not detect package manager type. No lockfile found.'));
      console.log(chalk.gray('   Tried: package-lock.json, pnpm-lock.yaml, yarn.lock'));
      process.exit(1);
    }
    console.log(chalk.gray('Type:       ') + chalk.green(type) + chalk.gray(' (auto-detected)'));
  } else {
    console.log(chalk.gray(`Type:       ${chalk.white(type)}`));
  }

  // Fetch lockfile
  const lockfileName = LOCKFILE_PATTERNS[type];
  console.log(chalk.gray(`\n📥 Fetching ${lockfileName}...`));

  const lockfileContent = await fetchGitHubFile(repo, branch, lockfileName);
  if (!lockfileContent) {
    console.error(chalk.red(`\n❌ Lockfile not found: ${lockfileName}`));
    process.exit(1);
  }
  console.log(
    chalk.green(`   ✓ ${lockfileName} (${(lockfileContent.length / 1024).toFixed(1)} KB)`)
  );

  // Fetch root package.json
  console.log(chalk.gray('📥 Fetching package.json...'));
  const rootPkgContent = await fetchGitHubFile(repo, branch, 'package.json');
  if (!rootPkgContent) {
    console.error(chalk.red('\n❌ Root package.json not found'));
    process.exit(1);
  }
  console.log(chalk.green(`   ✓ package.json (${(rootPkgContent.length / 1024).toFixed(1)} KB)`));

  // Resolve available workspaces
  const availableWorkspaces = await resolveWorkspaces(
    repo,
    branch,
    type,
    lockfileContent,
    rootPkgContent
  );

  if (verbose) {
    console.log(chalk.gray(`\n📋 Available workspaces (${availableWorkspaces.length}):`));
    for (const ws of availableWorkspaces.slice(0, 10)) {
      console.log(chalk.gray(`   - ${ws}`));
    }
    if (availableWorkspaces.length > 10) {
      console.log(chalk.gray(`   ... and ${availableWorkspaces.length - 10} more`));
    }
  }

  // Always fetch ALL workspace package.json files (CycloneDX needs complete structure)
  // The -w flag specifies which workspaces to TEST, but we fetch all
  const testWorkspaces = requestedWorkspaces || availableWorkspaces.slice(0, 3);

  // Validate test workspaces exist
  const invalidWorkspaces = testWorkspaces.filter(
    ws => !availableWorkspaces.includes(ws) && !availableWorkspaces.some(p => p.includes('*'))
  );

  if (invalidWorkspaces.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Some test workspaces not found in lockfile:`));
    for (const ws of invalidWorkspaces) {
      console.log(chalk.yellow(`   - ${ws}`));
    }
  }

  // Fetch ALL workspace package.json files
  console.log(
    chalk.gray(`\n📥 Fetching ALL workspace package.json files (${availableWorkspaces.length})...`)
  );

  const workspacePackages = new Map();
  for (const ws of availableWorkspaces) {
    const pkgPath = `${ws}/package.json`;
    const pkgContent = await fetchGitHubFile(repo, branch, pkgPath);

    if (pkgContent) {
      workspacePackages.set(ws, pkgContent);
      console.log(chalk.green(`   ✓ ${pkgPath}`));
    } else {
      console.log(chalk.yellow(`   ⚠️ ${pkgPath} not found`));
    }
  }

  // Create output directory structure
  const [owner, repoName] = repo.split('/');
  const fixtureDir = join(output, type, `${owner}-${repoName}`);

  console.log(chalk.gray(`\n📁 Output directory: ${chalk.white(fixtureDir)}`));

  if (dryRun) {
    console.log(chalk.cyan('\n🔍 Dry run - files that would be created:'));
    console.log(chalk.gray(`   ${fixtureDir}/${lockfileName}`));
    console.log(chalk.gray(`   ${fixtureDir}/package.json`));
    console.log(chalk.gray(`   ${fixtureDir}/metadata.json`));
    for (const ws of workspacePackages.keys()) {
      console.log(chalk.gray(`   ${fixtureDir}/${ws}/package.json`));
    }
    console.log(chalk.green('\n✅ Dry run complete'));
    return;
  }

  // Check if fixture already exists
  try {
    const existingMetadata = await readFile(join(fixtureDir, 'metadata.json'), 'utf8');
    if (!force) {
      const meta = JSON.parse(existingMetadata);
      console.log(chalk.yellow(`\n⚠️  Fixture already exists (fetched ${meta.fetchedAt})`));
      console.log(chalk.gray('   Use --force to overwrite'));
      process.exit(0);
    }
  } catch {
    // Fixture doesn't exist, continue
  }

  // Create directories and write files
  await mkdir(fixtureDir, { recursive: true });

  // Write lockfile
  await writeFile(join(fixtureDir, lockfileName), lockfileContent);
  console.log(chalk.green(`   ✓ wrote ${lockfileName}`));

  // Write root package.json (minimal version for workspaces field)
  const rootPkg = JSON.parse(rootPkgContent);
  const minimalRoot = {
    name: rootPkg.name || basename(repo),
    private: rootPkg.private,
    workspaces: rootPkg.workspaces
  };
  await writeFile(join(fixtureDir, 'package.json'), JSON.stringify(minimalRoot, null, 2) + '\n');
  console.log(chalk.green('   ✓ wrote package.json'));

  // Write workspace package.json files
  for (const [ws, pkgContent] of workspacePackages) {
    const wsDir = join(fixtureDir, ws);
    await mkdir(wsDir, { recursive: true });
    await writeFile(join(wsDir, 'package.json'), createMinimalPackageJson(pkgContent) + '\n');
    console.log(chalk.green(`   ✓ wrote ${ws}/package.json`));
  }

  // Write metadata
  const validTestWorkspaces = testWorkspaces.filter(ws => workspacePackages.has(ws));
  const metadata = {
    repo,
    branch,
    type,
    fetchedAt: new Date().toISOString().split('T')[0],
    lockfileVersion: getLockfileVersion(lockfileContent, type),
    workspaces: [...workspacePackages.keys()],
    testWorkspaces: validTestWorkspaces
  };
  await writeFile(join(fixtureDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(chalk.green('   ✓ wrote metadata.json'));

  console.log(chalk.bold.green(`\n✅ Fixture created successfully!`));
  console.log(chalk.gray(`   ${fixtureDir}`));
  console.log(chalk.gray(`   ${workspacePackages.size} workspaces fetched`));
  console.log(chalk.gray(`   ${validTestWorkspaces.length} workspaces configured for testing`));
}

/**
 * Extract lockfile version from content
 */
function getLockfileVersion(content, type) {
  try {
    if (type === 'npm') {
      const lockfile = JSON.parse(content);
      return lockfile.lockfileVersion || 1;
    }
    if (type === 'pnpm') {
      const match = content.match(/lockfileVersion:\s*['"]?([0-9.]+)/);
      return match ? match[1] : 'unknown';
    }
    if (type === 'yarn-berry') {
      const match = content.match(/__metadata:\s*\n\s*version:\s*(\d+)/);
      return match ? parseInt(match[1], 10) : 'unknown';
    }
    if (type === 'yarn-classic') {
      return 1;
    }
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

main().catch(err => {
  console.error(chalk.red(`\n❌ Fatal error: ${err.message}`));
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
