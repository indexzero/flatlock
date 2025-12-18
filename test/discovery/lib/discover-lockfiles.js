/**
 * @fileoverview Phase 3: Lockfile Discovery
 * Queries GitHub GraphQL API for all lockfile types and detects package managers
 *
 * This phase:
 * 1. Loads packuments from Phase 1
 * 2. Fetches package manager files from GitHub for each repo
 * 3. Detects lockfile type and version
 * 4. Categorizes results by format
 * 5. Stores discovery results for further processing
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGitHubClient, fetchRepositoryFiles } from './github-client.js';
import { detectPackageManager, categorizeLockfile, formatLockfileType } from './detect-package-manager.js';
import {
  progress,
  createProgressCounter,
  atomicWriteJSON,
  parseGitHubUrl,
} from './utils.js';

/**
 * @typedef {Object} DiscoveryResult
 * @property {string} name - Package name
 * @property {string} repo - GitHub owner/name
 * @property {number} rank - npm-high-impact rank
 * @property {string} category - Lockfile category (e.g., 'npm-v3', 'pnpm-v9')
 * @property {import('./detect-package-manager.js').DetectionResult} detection
 * @property {string|null} error - Error message if fetch failed
 * @property {Object} metadata - Repository metadata
 */

/**
 * @typedef {Object} DiscoverLockfilesOptions
 * @property {string} [packumentsPath] - Path to packuments.json
 * @property {string} [outputPath] - Path for discovery-results.json
 * @property {string} [token] - GitHub token
 * @property {number} [limit] - Limit number of repos to process
 * @property {boolean} [skipArchived=true] - Skip archived repositories
 */

/**
 * Discover lockfiles for all packages with GitHub repos
 *
 * @param {DiscoverLockfilesOptions} [options={}]
 * @returns {Promise<DiscoveryResult[]>}
 */
export async function discoverLockfiles(options = {}) {
  const {
    packumentsPath = join(import.meta.dirname, '..', 'data', 'packuments.json'),
    outputPath = join(import.meta.dirname, '..', 'data', 'discovery-results.json'),
    token,
    limit,
    skipArchived = true,
  } = options;

  // Load packuments from Phase 1
  progress('Loading packuments from Phase 1...');
  const packumentsData = JSON.parse(await readFile(packumentsPath, 'utf-8'));
  let packages = packumentsData.packages.filter((p) => p.repo);

  if (limit && limit > 0) {
    packages = packages.slice(0, limit);
  }

  progress(`Processing ${packages.length} packages with GitHub repos`);

  // Create GitHub client
  const client = createGitHubClient({ token, concurrency: 10 });

  const progressCounter = createProgressCounter('Discovering lockfiles', packages.length);
  const results = [];
  const categories = {
    'npm-v1': [],
    'npm-v2': [],
    'npm-v3': [],
    'npm-unknown': [],
    'pnpm-v5': [],
    'pnpm-v6': [],
    'pnpm-v9': [],
    'pnpm-unknown': [],
    'yarn-classic': [],
    'yarn-berry': [],
    none: [],
    error: [],
  };

  // Process packages in parallel (rate limited by client)
  await Promise.all(
    packages.map(async (pkg) => {
      const { owner, name } = parseGitHubUrl(`https://github.com/${pkg.repo}`) || {};

      if (!owner || !name) {
        results.push({
          name: pkg.name,
          repo: pkg.repo,
          rank: pkg.rank,
          category: 'error',
          detection: null,
          error: 'Invalid GitHub URL',
          metadata: null,
        });
        categories.error.push(pkg.name);
        progressCounter.increment();
        return;
      }

      try {
        const files = await fetchRepositoryFiles(client, owner, name);

        if (!files) {
          results.push({
            name: pkg.name,
            repo: pkg.repo,
            rank: pkg.rank,
            category: 'error',
            detection: null,
            error: 'Repository not found or inaccessible',
            metadata: null,
          });
          categories.error.push(pkg.name);
          progressCounter.increment();
          return;
        }

        // Skip archived repos if configured
        if (skipArchived && files.metadata?.isArchived) {
          results.push({
            name: pkg.name,
            repo: pkg.repo,
            rank: pkg.rank,
            category: 'archived',
            detection: null,
            error: 'Repository is archived',
            metadata: files.metadata,
          });
          progressCounter.increment();
          return;
        }

        // Detect package manager
        const detection = detectPackageManager(files);
        const category = categorizeLockfile(detection);

        const result = {
          name: pkg.name,
          repo: pkg.repo,
          rank: pkg.rank,
          category,
          detection,
          error: null,
          metadata: files.metadata,
        };

        results.push(result);

        if (categories[category]) {
          categories[category].push(pkg.name);
        }
      } catch (err) {
        results.push({
          name: pkg.name,
          repo: pkg.repo,
          rank: pkg.rank,
          category: 'error',
          detection: null,
          error: err.message,
          metadata: null,
        });
        categories.error.push(pkg.name);
      }

      progressCounter.increment();
    })
  );

  progressCounter.done();

  // Sort by original rank
  results.sort((a, b) => a.rank - b.rank);

  // Calculate statistics
  const stats = {
    total: results.length,
    byCategory: {},
    monorepos: {
      total: 0,
      turborepo: 0,
      lerna: 0,
      nx: 0,
      'pnpm-workspaces': 0,
      'yarn-workspaces': 0,
      'npm-workspaces': 0,
    },
    archived: 0,
    errors: categories.error.length,
  };

  for (const [category, pkgs] of Object.entries(categories)) {
    if (category !== 'error' && category !== 'archived') {
      stats.byCategory[category] = pkgs.length;
    }
  }

  // Count monorepos
  for (const result of results) {
    if (result.detection?.isMonorepo) {
      stats.monorepos.total++;
      const tool = result.detection.monorepoTool;
      if (tool && stats.monorepos[tool] !== undefined) {
        stats.monorepos[tool]++;
      }
    }
    if (result.category === 'archived') {
      stats.archived++;
    }
  }

  // Log summary
  progress('Discovery Summary:');
  progress(`  npm: v1=${stats.byCategory['npm-v1'] || 0}, v2=${stats.byCategory['npm-v2'] || 0}, v3=${stats.byCategory['npm-v3'] || 0}`);
  progress(`  pnpm: v5=${stats.byCategory['pnpm-v5'] || 0}, v6=${stats.byCategory['pnpm-v6'] || 0}, v9=${stats.byCategory['pnpm-v9'] || 0}`);
  progress(`  yarn: classic=${stats.byCategory['yarn-classic'] || 0}, berry=${stats.byCategory['yarn-berry'] || 0}`);
  progress(`  no lockfile: ${stats.byCategory['none'] || 0}`);
  progress(`  monorepos: ${stats.monorepos.total}`);
  progress(`  archived: ${stats.archived}`);
  progress(`  errors: ${stats.errors}`);

  // Check rate limit
  const rateLimit = client.getRateLimit();
  progress(`GitHub rate limit remaining: ${rateLimit.remaining}`);

  // Write output
  if (outputPath) {
    const output = {
      generatedAt: new Date().toISOString(),
      packumentsSource: packumentsPath,
      stats,
      categories,
      results,
    };

    await atomicWriteJSON(outputPath, output);
    progress(`Wrote discovery results to ${outputPath}`);
  }

  return results;
}

/**
 * Load previously saved discovery results
 *
 * @param {string} filePath
 * @returns {Promise<{stats: Object, categories: Object, results: DiscoveryResult[]}>}
 */
export async function loadDiscoveryResults(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Filter discovery results by category
 *
 * @param {DiscoveryResult[]} results
 * @param {string} category - e.g., 'npm-v3', 'pnpm-v9', 'yarn-berry'
 * @returns {DiscoveryResult[]}
 */
export function filterByCategory(results, category) {
  return results.filter((r) => r.category === category);
}

/**
 * Filter discovery results to monorepos
 *
 * @param {DiscoveryResult[]} results
 * @param {string} [tool] - Optional: filter by specific tool
 * @returns {DiscoveryResult[]}
 */
export function filterMonorepos(results, tool) {
  return results.filter((r) => {
    if (!r.detection?.isMonorepo) return false;
    if (tool && r.detection.monorepoTool !== tool) return false;
    return true;
  });
}

/**
 * Get packages suitable for test fixtures
 * Filters out errors, archived repos, and those without lockfiles
 *
 * @param {DiscoveryResult[]} results
 * @returns {DiscoveryResult[]}
 */
export function getValidPackages(results) {
  return results.filter(
    (r) => r.category !== 'error' && r.category !== 'archived' && r.category !== 'none'
  );
}

/**
 * Main entry point for CLI usage
 */
export async function main() {
  const packumentsPath = join(import.meta.dirname, '..', 'data', 'packuments.json');
  const outputPath = join(import.meta.dirname, '..', 'data', 'discovery-results.json');

  const results = await discoverLockfiles({
    packumentsPath,
    outputPath,
  });

  const valid = getValidPackages(results);
  progress(`Found ${valid.length} packages with valid lockfiles`);

  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
