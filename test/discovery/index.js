#!/usr/bin/env node

/**
 * @fileoverview Lockfile Discovery Pipeline for flatlock
 *
 * This tool collects lockfiles from high-impact npm packages for testing flatlock's parsers.
 * It implements a data mining approach to discover which packages use which lockfile formats,
 * then mines historical versions to fill coverage gaps.
 *
 * Phases:
 * - Phase 1: Fetch packuments from npm registry, extract GitHub URLs
 * - Phase 3: Query GitHub for lockfiles, detect package manager
 * - Phase 4: Mine historical lockfiles to fill coverage gaps
 * - Phase 5: Classify and validate lockfiles with flatlock
 *
 * Usage:
 *   node index.js [options]
 *
 * Options:
 *   --phase=N       Run specific phase only (1, 3, 4, or 5)
 *   --limit=N       Limit number of packages to process
 *   --dry-run       Show what would be done without fetching
 *   --help          Show this help message
 *
 * Environment:
 *   GITHUB_TOKEN    Required for Phase 3 and 4 (GitHub API access)
 *
 * Examples:
 *   node index.js                    # Run all phases
 *   node index.js --phase=1          # Fetch packuments only
 *   node index.js --phase=3          # Discover lockfiles only
 *   node index.js --phase=4          # Mine historical lockfiles
 *   node index.js --phase=5          # Classify and validate
 *   node index.js --limit=100        # Process first 100 packages
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { fetchPackuments } from './lib/fetch-packuments.js';
import { discoverLockfiles } from './lib/discover-lockfiles.js';
import { progress } from './lib/utils.js';
import {
  identifyGaps,
  createMiningPlan,
  executeMiningWithResume,
  summarizeMiningResults
} from './lib/index.js';
import {
  validateDirectory,
  generateReport
} from './lib/index.js';

const DATA_DIR = join(import.meta.dirname, 'data');
const PACKUMENTS_PATH = join(DATA_DIR, 'packuments.json');
const DISCOVERY_PATH = join(DATA_DIR, 'discovery-results.json');
const HISTORICAL_DIR = join(DATA_DIR, 'historical');
const MINING_RESULTS_PATH = join(DATA_DIR, 'mining-results.json');
const VALIDATION_REPORT_PATH = join(DATA_DIR, 'validation-report.md');

/**
 * @typedef {Object} CliOptions
 * @property {number|null} phase - Phase to run (1 or 3, null for all)
 * @property {number} limit - Package limit
 * @property {boolean} dryRun - Dry run mode
 * @property {boolean} help - Show help
 */

/**
 * Parse command line arguments
 *
 * @param {string[]} args
 * @returns {CliOptions}
 */
function parseArgs(args) {
  const options = {
    phase: null,
    limit: 1000,
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--phase=')) {
      options.phase = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

/**
 * Print usage information
 */
function printHelp() {
  const help = `
Lockfile Discovery Pipeline for flatlock

USAGE:
  node index.js [options]

OPTIONS:
  --phase=N       Run specific phase only
                    1 = Fetch packuments from npm registry
                    3 = Discover lockfiles from GitHub
                    4 = Mine historical lockfiles
                    5 = Classify and validate with flatlock
  --limit=N       Limit number of packages (default: 1000)
  --dry-run       Show what would be done without fetching
  --help, -h      Show this help message

ENVIRONMENT:
  GITHUB_TOKEN    Required for Phase 3 and 4 (GitHub API access)
                  Create at: https://github.com/settings/tokens
                  Required scope: public_repo

OUTPUT:
  data/packuments.json         Phase 1 - npm registry packuments
  data/discovery-results.json  Phase 3 - current lockfile detection
  data/historical/             Phase 4 - mined historical lockfiles
  data/mining-results.json     Phase 4 - mining results summary
  data/validation-report.md    Phase 5 - flatlock validation report

EXAMPLES:
  # Run complete pipeline
  GITHUB_TOKEN=ghp_xxx node index.js

  # Fetch packuments only
  node index.js --phase=1

  # Discover lockfiles (requires packuments.json)
  GITHUB_TOKEN=ghp_xxx node index.js --phase=3

  # Mine historical lockfiles (requires discovery-results.json)
  GITHUB_TOKEN=ghp_xxx node index.js --phase=4

  # Validate with flatlock (requires historical/)
  node index.js --phase=5

  # Test with limited packages
  node index.js --limit=50

  # Preview without fetching
  node index.js --dry-run
`;
  console.log(help);
}

/**
 * Run Phase 1: Package Discovery
 *
 * @param {CliOptions} options
 */
async function runPhase1(options) {
  progress('=== Phase 1: Package Discovery ===');
  progress(`Fetching top ${options.limit} packuments from npm registry...`);

  await fetchPackuments({
    limit: options.limit,
    outputPath: PACKUMENTS_PATH,
    dryRun: options.dryRun,
  });

  progress('Phase 1 complete');
}

/**
 * Run Phase 3: Lockfile Discovery
 *
 * @param {CliOptions} options
 */
async function runPhase3(options) {
  progress('=== Phase 3: Lockfile Discovery ===');

  // Check prerequisites
  if (!existsSync(PACKUMENTS_PATH)) {
    throw new Error(
      `Phase 1 output not found: ${PACKUMENTS_PATH}\n` +
        'Run Phase 1 first: node index.js --phase=1'
    );
  }

  if (!process.env.GITHUB_TOKEN && !options.dryRun) {
    throw new Error(
      'GITHUB_TOKEN environment variable required for Phase 3.\n' +
        'Create a token at: https://github.com/settings/tokens\n' +
        'Required scope: public_repo'
    );
  }

  if (options.dryRun) {
    progress('Dry run - would query GitHub for lockfiles');
    return;
  }

  await discoverLockfiles({
    packumentsPath: PACKUMENTS_PATH,
    outputPath: DISCOVERY_PATH,
    limit: options.limit,
  });

  progress('Phase 3 complete');
}

/**
 * Run Phase 4: Historical Lockfile Mining
 *
 * @param {CliOptions} options
 */
async function runPhase4(options) {
  progress('=== Phase 4: Historical Lockfile Mining ===');

  // Check prerequisites
  if (!existsSync(DISCOVERY_PATH)) {
    throw new Error(
      `Phase 3 output not found: ${DISCOVERY_PATH}\n` +
        'Run Phase 3 first: node index.js --phase=3'
    );
  }

  if (!existsSync(PACKUMENTS_PATH)) {
    throw new Error(
      `Phase 1 output not found: ${PACKUMENTS_PATH}\n` +
        'Run Phase 1 first: node index.js --phase=1'
    );
  }

  if (!process.env.GITHUB_TOKEN && !options.dryRun) {
    throw new Error(
      'GITHUB_TOKEN environment variable required for Phase 4.\n' +
        'Create a token at: https://github.com/settings/tokens'
    );
  }

  // Load discovery results and packuments
  const discoveryResults = JSON.parse(await readFile(DISCOVERY_PATH, 'utf-8'));
  const packumentsData = JSON.parse(await readFile(PACKUMENTS_PATH, 'utf-8'));

  // Build a map of package -> currentFormat from discovery results
  const formatMap = new Map();
  for (const [category, packages] of Object.entries(discoveryResults.categories || {})) {
    // Extract format from category (e.g., "npm-v3" -> "npm", "yarn-berry" -> "yarn-berry")
    const format = category.replace(/-v\d+$/, '').replace(/-unknown$/, '');
    for (const pkgName of packages) {
      formatMap.set(pkgName, format);
    }
  }

  // Merge currentFormat into packuments
  const packumentsWithFormat = packumentsData.packages.map(pkg => ({
    ...pkg,
    currentFormat: formatMap.get(pkg.name) || null
  }));

  // Analyze gaps
  const gaps = identifyGaps(discoveryResults);
  progress('Coverage gaps:');
  for (const gap of gaps) {
    if (gap.needed > 0) {
      progress(`  ${gap.era}: need ${gap.needed} more (have ${gap.current}/${gap.target})`);
    }
  }

  if (options.dryRun) {
    progress('Dry run - would mine historical lockfiles to fill gaps');
    return;
  }

  // Create mining plan (using packuments with merged format info)
  const { plan } = createMiningPlan(discoveryResults, packumentsWithFormat);
  progress(`Mining plan: ${plan.length} candidates to fetch`);

  // Ensure output directory exists
  await mkdir(HISTORICAL_DIR, { recursive: true });

  // Execute mining with resume support
  const miningStatePath = join(DATA_DIR, 'mining-state.json');
  const startTime = Date.now();
  const statusCounts = { success: 0, 'tag-not-found': 0, 'no-lockfile': 0, 'wrong-format': 0, error: 0 };

  const results = await executeMiningWithResume(plan, HISTORICAL_DIR, miningStatePath, {
    concurrency: 3,
    onProgress: (i, total, result) => {
      statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;

      const { candidate } = result;
      const version = candidate.targetVersion;
      const tag = result.tagName || `v${version}`;
      const repoUrl = `https://github.com/${candidate.owner}/${candidate.repo}`;
      const treeUrl = `${repoUrl}/tree/${tag}`;

      // Outcome message
      let outcome;
      if (result.status === 'success') {
        outcome = `✓ found ${result.lockfileType} v${result.lockfileVersion}`;
      } else if (result.status === 'tag-not-found') {
        outcome = '✗ tag not found';
      } else if (result.status === 'no-lockfile') {
        outcome = '✗ no lockfile in repo';
      } else if (result.status === 'wrong-format') {
        outcome = `✗ wrong format (found ${result.lockfileType})`;
      } else if (result.status === 'error') {
        outcome = `✗ ${result.error?.slice(0, 80) || 'unknown error'}`;
      } else {
        outcome = `✗ ${result.status}`;
      }

      // Format date as YYYY/MM/DD
      const versionDate = new Date(candidate.versionDate);
      const dateStr = `${versionDate.getFullYear()}/${String(versionDate.getMonth() + 1).padStart(2, '0')}/${String(versionDate.getDate()).padStart(2, '0')}`;

      // Effect-errors style output
      progress(`[${i + 1}/${total}] ${candidate.packageName}@${version}`);
      progress(`  ├─ (era)     ${candidate.targetEra}`);
      progress(`  ├─ (from)    ${dateStr}`);
      progress(`  ├─ (url)     ${treeUrl}`);
      progress(`  └─ (outcome) ${outcome}`);

      // Show running totals every 25 items
      if ((i + 1) % 25 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const summary = Object.entries(statusCounts)
          .filter(([_, v]) => v > 0)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ');
        progress(`  ─── [${elapsed}s] totals: ${summary} ───`);
      }
    }
  });

  // Summarize results
  const resultSummary = summarizeMiningResults(results);
  progress('');
  progress('═══ Mining Results ═══');
  progress(`  Total:         ${resultSummary.total}`);
  progress(`  Success:       ${resultSummary.success}`);
  progress(`  Tag not found: ${resultSummary.tagNotFound}`);
  progress(`  No lockfile:   ${resultSummary.noLockfile}`);
  progress(`  Wrong format:  ${resultSummary.wrongFormat}`);
  progress(`  Errors:        ${resultSummary.error}`);
  progress('');
  progress('─── Success by Era ───');
  for (const [era, counts] of Object.entries(resultSummary.byEra).sort()) {
    const total = counts.success + counts.failed;
    const pct = total > 0 ? Math.round((counts.success / total) * 100) : 0;
    progress(`  ${era.padEnd(16)} ${counts.success}/${total} (${pct}%)`);
  }

  // Save results
  const { atomicWriteJSON } = await import('./lib/utils.js');
  await atomicWriteJSON(MINING_RESULTS_PATH, { results, summary: resultSummary });

  progress('Phase 4 complete');
}

/**
 * Run Phase 5: Classification and Validation
 *
 * @param {CliOptions} options
 */
async function runPhase5(options) {
  progress('=== Phase 5: Classification and Validation ===');

  if (options.dryRun) {
    progress('Dry run - would classify and validate lockfiles');
    return;
  }

  // Validate all lockfiles in discovery data and historical
  const dirsToValidate = [HISTORICAL_DIR];

  // Also validate lockfiles from discovery if they exist
  const discoveryLockfilesDir = join(DATA_DIR, 'lockfiles');
  if (existsSync(discoveryLockfilesDir)) {
    dirsToValidate.push(discoveryLockfilesDir);
  }

  let totalResults = [];
  for (const dir of dirsToValidate) {
    if (!existsSync(dir)) {
      progress(`Skipping ${dir} (does not exist)`);
      continue;
    }

    progress(`Validating lockfiles in ${dir}...`);
    const { results, summary } = await validateDirectory(dir);
    totalResults = totalResults.concat(results);

    progress(`  Total: ${summary.total}`);
    progress(`  Passed: ${summary.passed}`);
    progress(`  Failed: ${summary.failed}`);
  }

  // Generate validation report
  if (totalResults.length > 0) {
    const report = await generateReport(totalResults);
    const { atomicWriteFile } = await import('./lib/utils.js');
    await atomicWriteFile(VALIDATION_REPORT_PATH, report);
    progress(`Validation report written to ${VALIDATION_REPORT_PATH}`);
  }

  progress('Phase 5 complete');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  progress('Flatlock Discovery Pipeline');
  progress(`Working directory: ${import.meta.dirname}`);
  progress(`Data directory: ${DATA_DIR}`);

  if (options.dryRun) {
    progress('DRY RUN MODE - no data will be fetched or written');
  }

  const startTime = Date.now();

  try {
    if (options.phase === 1) {
      await runPhase1(options);
    } else if (options.phase === 3) {
      await runPhase3(options);
    } else if (options.phase === 4) {
      await runPhase4(options);
    } else if (options.phase === 5) {
      await runPhase5(options);
    } else {
      // Run all phases
      await runPhase1(options);
      await runPhase3(options);
      await runPhase4(options);
      await runPhase5(options);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    progress(`Pipeline completed in ${elapsed}s`);
  } catch (err) {
    progress(`ERROR: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Export for testing
export { parseArgs, runPhase1, runPhase3, runPhase4, runPhase5 };

// Run if executed directly
main();
