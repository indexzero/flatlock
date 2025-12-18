/**
 * @fileoverview Phase 1: Package Discovery
 * Fetches packuments from npm registry for high-impact packages
 *
 * Strategy:
 * 1. Load top 1000 packages from npm-high-impact
 * 2. Fetch packuments from registry with rate limiting
 * 3. Extract GitHub repository URLs
 * 4. Store results for Phase 3 processing
 */

import { npmHighImpact } from 'npm-high-impact';
import pLimit from 'p-limit';
import { join } from 'node:path';
import {
  retry,
  delay,
  progress,
  createProgressCounter,
  atomicWriteJSON,
  parseGitHubUrl,
} from './utils.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_LIMIT = 1000;
const DELAY_BETWEEN_REQUESTS = 50; // ms - npm is generous but be polite
const CONCURRENCY = 20; // Parallel requests

/**
 * @typedef {Object} PackumentInfo
 * @property {string} name - Package name
 * @property {string|null} repo - GitHub owner/name (e.g., "lodash/lodash")
 * @property {string|null} latest - Latest version
 * @property {string|null} created - Package creation date
 * @property {string|null} modified - Last modification date
 * @property {Object<string, string>|null} time - Version timestamps (for historical mining)
 * @property {number} rank - npm-high-impact rank (0-based index)
 * @property {Object|null} repository - Raw repository field from packument
 */

/**
 * @typedef {Object} FetchPackumentsOptions
 * @property {number} [limit=1000] - Number of packages to fetch
 * @property {string} [outputPath] - Output file path
 * @property {boolean} [dryRun=false] - Skip fetching, just list packages
 */

/**
 * Fetch a packument from the npm registry
 *
 * @param {string} packageName - Package name
 * @returns {Promise<Object>}
 */
async function fetchPackument(packageName) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`;

  return retry(
    async () => {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'flatlock-discovery/1.0',
        },
      });

      if (!response.ok) {
        const error = new Error(`npm registry error: ${response.status} for ${packageName}`);
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    {
      retries: 3,
      minTimeout: 1000,
      shouldRetry: (err) => err.status === 429 || err.status >= 500,
    }
  );
}

/**
 * Extract relevant info from a packument
 *
 * @param {Object} packument - Raw packument from registry
 * @param {number} rank - Package rank in npm-high-impact
 * @returns {PackumentInfo}
 */
function extractPackumentInfo(packument, rank) {
  const repoUrl = packument.repository?.url || '';
  const githubInfo = parseGitHubUrl(repoUrl);

  return {
    name: packument.name,
    repo: githubInfo ? `${githubInfo.owner}/${githubInfo.name}` : null,
    latest: packument['dist-tags']?.latest || null,
    created: packument.time?.created || null,
    modified: packument.time?.modified || null,
    time: packument.time || null, // Full version timestamps for historical mining
    rank,
    repository: packument.repository || null,
  };
}

/**
 * Fetch packuments for top high-impact packages
 *
 * @param {FetchPackumentsOptions} [options={}]
 * @returns {Promise<PackumentInfo[]>}
 */
export async function fetchPackuments(options = {}) {
  const { limit = DEFAULT_LIMIT, outputPath, dryRun = false } = options;

  // Get top N packages from npm-high-impact
  const topPackages = npmHighImpact.slice(0, limit);
  progress(`Loaded ${topPackages.length} packages from npm-high-impact`);

  if (dryRun) {
    progress('Dry run - skipping fetch');
    return topPackages.map((name, rank) => ({
      name,
      repo: null,
      latest: null,
      created: null,
      modified: null,
      time: null,
      rank,
      repository: null,
    }));
  }

  const progressCounter = createProgressCounter('Fetching packuments', topPackages.length);
  const limiter = pLimit(CONCURRENCY);
  const results = [];
  const errors = [];

  // Fetch packuments with rate limiting
  await Promise.all(
    topPackages.map((packageName, rank) =>
      limiter(async () => {
        // Add small delay to spread requests
        await delay(Math.floor(rank / CONCURRENCY) * DELAY_BETWEEN_REQUESTS);

        try {
          const packument = await fetchPackument(packageName);
          const info = extractPackumentInfo(packument, rank);
          results.push(info);
        } catch (err) {
          progress(`Error fetching ${packageName}: ${err.message}`);
          errors.push({ name: packageName, rank, error: err.message });
          // Still add entry with null values
          results.push({
            name: packageName,
            repo: null,
            latest: null,
            created: null,
            modified: null,
            time: null,
            rank,
            repository: null,
            error: err.message,
          });
        }

        progressCounter.increment();
      })
    )
  );

  progressCounter.done();

  // Sort by original rank
  results.sort((a, b) => a.rank - b.rank);

  // Calculate statistics
  const stats = {
    total: results.length,
    withGitHub: results.filter((r) => r.repo).length,
    withoutGitHub: results.filter((r) => !r.repo && !r.error).length,
    errors: errors.length,
  };

  progress(`Stats: ${stats.withGitHub} with GitHub, ${stats.withoutGitHub} without, ${stats.errors} errors`);

  // Write output if path provided
  if (outputPath) {
    const output = {
      generatedAt: new Date().toISOString(),
      source: 'npm-high-impact',
      stats,
      packages: results,
    };

    await atomicWriteJSON(outputPath, output);
    progress(`Wrote ${results.length} packuments to ${outputPath}`);
  }

  return results;
}

/**
 * Load previously fetched packuments from file
 *
 * @param {string} filePath - Path to packuments.json
 * @returns {Promise<{stats: Object, packages: PackumentInfo[]}>}
 */
export async function loadPackuments(filePath) {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Filter packuments to those with GitHub repositories
 *
 * @param {PackumentInfo[]} packuments
 * @returns {PackumentInfo[]}
 */
export function filterWithGitHub(packuments) {
  return packuments.filter((p) => p.repo !== null);
}

/**
 * Main entry point for CLI usage
 */
export async function main() {
  const outputPath = join(import.meta.dirname, '..', 'data', 'packuments.json');

  const results = await fetchPackuments({
    limit: DEFAULT_LIMIT,
    outputPath,
  });

  const withGitHub = filterWithGitHub(results);
  progress(`Found ${withGitHub.length} packages with GitHub repositories`);

  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
