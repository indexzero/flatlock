/**
 * Historical Lockfile Mining
 *
 * Orchestrates the process of finding and fetching historical lockfiles
 * from packages that existed during different lockfile version eras.
 *
 * @module test/discovery/lib/mine-historical
 */

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, rename, unlink, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  ERAS,
  TARGET_COUNT_PER_FORMAT,
  FORMATS,
  findBestVersionForEra,
  hasVersionsInEra,
  versionToEra,
  getHistoricalEras
} from './eras.js';
import {
  findVersionTag,
  fetchHistoricalLockfiles,
  parseRepoUrl
} from './find-version-tags.js';

/**
 * @typedef {Object} GapAnalysis
 * @property {string} era - Era key
 * @property {string} format - Lockfile format
 * @property {number} current - Current count
 * @property {number} target - Target count
 * @property {number} needed - How many more needed
 */

/**
 * @typedef {Object} MiningCandidate
 * @property {string} packageName - npm package name
 * @property {string} owner - GitHub owner
 * @property {string} repo - GitHub repo name
 * @property {string} targetEra - Target era key
 * @property {string} targetVersion - Version to fetch
 * @property {Date} versionDate - When this version was published
 * @property {string} currentFormat - Package's current lockfile format
 */

/**
 * @typedef {Object} MiningResult
 * @property {MiningCandidate} candidate - Original candidate
 * @property {'success'|'tag-not-found'|'commit-not-found'|'no-lockfile'|'wrong-format'|'error'} status
 * @property {string} [tagName] - Found tag name
 * @property {string} [commitSha] - Commit SHA
 * @property {string} [commitDate] - Commit date
 * @property {string} [lockfileType] - Detected lockfile type
 * @property {string} [lockfileVersion] - Detected version
 * @property {string} [savedPath] - Path where lockfile was saved
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} DiscoveryResults
 * @property {Object<string, Object<string, string[]>>} byFormat - Packages grouped by format and version
 * @property {Object<string, string[]>} monorepos - Monorepo packages by tool
 */

/**
 * @typedef {Object} PackumentSummary
 * @property {string} name - Package name
 * @property {string} [repo] - GitHub repo (owner/name)
 * @property {Object<string, string>} [time] - Version timestamps
 * @property {string} [currentFormat] - Current detected lockfile format
 */

/**
 * Maximum size for in-memory lockfile handling (1MB).
 * Larger files are streamed to disk.
 */
const MAX_MEMORY_SIZE = 1024 * 1024;

/**
 * Identify gaps in lockfile format coverage.
 *
 * @param {DiscoveryResults} discoveryResults - Current discovery results
 * @param {number} [targetPerFormat=TARGET_COUNT_PER_FORMAT] - Target count per format
 * @returns {GapAnalysis[]} Array of gaps sorted by need (highest first)
 */
export function identifyGaps(discoveryResults, targetPerFormat = TARGET_COUNT_PER_FORMAT) {
  const gaps = [];
  const byFormat = discoveryResults.byFormat || {};

  // Check each era
  for (const [eraKey, era] of Object.entries(ERAS)) {
    const formatData = byFormat[era.format] || {};

    // Count packages for this era
    let current = 0;

    // Map era to lockfile versions and count
    if (era.format === 'npm') {
      if (eraKey === 'npm-v1') current = (formatData.v1 || []).length;
      else if (eraKey === 'npm-v2') current = (formatData.v2 || []).length;
      else if (eraKey === 'npm-v3') current = (formatData.v3 || []).length;
    } else if (era.format === 'pnpm') {
      if (eraKey === 'pnpm-shrinkwrap') current = (formatData.shrinkwrap || []).length;
      else if (eraKey === 'pnpm-v5') current = (formatData.v5 || []).length;
      else if (eraKey === 'pnpm-v6') current = (formatData.v6 || []).length;
      else if (eraKey === 'pnpm-v9') current = (formatData.v9 || []).length;
    } else if (era.format === 'yarn-classic') {
      current = (formatData.v1 || []).length;
    } else if (era.format === 'yarn-berry') {
      current = (formatData['v2+'] || formatData.v2 || []).length;
    }

    const needed = targetPerFormat - current;

    if (needed > 0) {
      gaps.push({
        era: eraKey,
        format: era.format,
        current,
        target: targetPerFormat,
        needed
      });
    }
  }

  // Sort by needed (highest first), then by format
  return gaps.sort((a, b) => {
    if (b.needed !== a.needed) return b.needed - a.needed;
    return a.format.localeCompare(b.format);
  });
}

/**
 * Find packages that are candidates for historical mining.
 * A candidate is a package that:
 * 1. Currently uses a DIFFERENT format than the target
 * 2. Existed during the target era
 * 3. Has a discoverable GitHub repository
 *
 * @param {PackumentSummary[]} packuments - Package summaries with time data
 * @param {string} targetEra - Era to find candidates for
 * @param {Object} [options] - Options
 * @param {number} [options.maxCandidates=30] - Maximum candidates to return
 * @returns {MiningCandidate[]} Sorted candidates (best first)
 */
export function findHistoricalCandidates(packuments, targetEra, options = {}) {
  const maxCandidates = options.maxCandidates ?? 30;
  const era = ERAS[targetEra];
  if (!era) return [];

  const candidates = [];

  for (const pkg of packuments) {
    // Must have GitHub repo
    if (!pkg.repo) continue;

    // Must use a different format currently (indicates migration)
    if (pkg.currentFormat === era.format) continue;

    // Must have time data
    if (!pkg.time) continue;

    // Find best version from target era
    const bestVersion = findBestVersionForEra({ time: pkg.time }, targetEra);
    if (!bestVersion) continue;

    // Parse repo URL
    const repoInfo = parseRepoUrl(pkg.repo);
    if (!repoInfo) continue;

    candidates.push({
      packageName: pkg.name,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      targetEra,
      targetVersion: bestVersion.version,
      versionDate: bestVersion.timestamp,
      currentFormat: pkg.currentFormat
    });
  }

  // Sort by version date (most recent first - more likely to have good tags)
  candidates.sort((a, b) => b.versionDate.getTime() - a.versionDate.getTime());

  return candidates.slice(0, maxCandidates);
}

/**
 * Create a mining plan based on gaps in discovery results.
 *
 * @param {DiscoveryResults} discoveryResults - Current discovery results
 * @param {PackumentSummary[]} packuments - Package summaries
 * @param {Object} [options] - Options
 * @param {number} [options.targetPerFormat] - Target per format
 * @param {number} [options.multiplier=2] - Get 2x candidates per gap
 * @returns {{gaps: GapAnalysis[], plan: MiningCandidate[]}}
 */
export function createMiningPlan(discoveryResults, packuments, options = {}) {
  const multiplier = options.multiplier ?? 2;

  const gaps = identifyGaps(discoveryResults, options.targetPerFormat);
  const plan = [];
  const usedPackages = new Set();

  for (const gap of gaps) {
    const candidates = findHistoricalCandidates(packuments, gap.era, {
      maxCandidates: gap.needed * multiplier
    });

    for (const candidate of candidates) {
      // Avoid duplicate packages in plan
      const key = `${candidate.packageName}@${candidate.targetEra}`;
      if (usedPackages.has(key)) continue;
      usedPackages.add(key);

      plan.push(candidate);
    }
  }

  return { gaps, plan };
}

/**
 * Write content atomically using write-ahead log pattern.
 *
 * @param {string} filePath - Target file path
 * @param {string|Buffer} content - Content to write
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const walPath = `${filePath}.wal`;

  // Write to WAL first
  await writeFile(walPath, content, 'utf8');

  // Rename to final path (atomic on POSIX)
  await rename(walPath, filePath);
}

/**
 * Stream large content to disk.
 *
 * @param {string} filePath - Target file path
 * @param {string} content - Content to stream
 * @returns {Promise<void>}
 */
async function streamToFile(filePath, content) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const walPath = `${filePath}.wal`;

  const readableStream = Readable.from([content]);
  const writeStream = createWriteStream(walPath);

  await pipeline(readableStream, writeStream);
  await rename(walPath, filePath);
}

/**
 * Determine lockfile type and version from fetched files.
 *
 * @param {Object} files - Files from fetchHistoricalLockfiles
 * @returns {{type: string|null, version: string|null, content: string|null, fileName: string|null}}
 */
function detectLockfileFromFiles(files) {
  // Check npm
  if (files.packageLock.content) {
    try {
      const parsed = JSON.parse(files.packageLock.content);
      return {
        type: 'npm',
        version: String(parsed.lockfileVersion || 1),
        content: files.packageLock.content,
        fileName: 'package-lock.json'
      };
    } catch {
      // Invalid JSON, skip
    }
  }

  // Check pnpm
  if (files.pnpmLock.content) {
    const versionMatch = files.pnpmLock.content.match(/lockfileVersion:\s*['"]?([^'\s\n]+)/);
    const shrinkwrapMatch = files.pnpmLock.content.match(/shrinkwrapVersion:\s*['"]?([^'\s\n]+)/);

    return {
      type: 'pnpm',
      version: versionMatch?.[1] || shrinkwrapMatch?.[1] || 'unknown',
      content: files.pnpmLock.content,
      fileName: 'pnpm-lock.yaml'
    };
  }

  // Check yarn
  if (files.yarnLock.content) {
    // Berry has __metadata section
    const isBerry = files.yarnLock.content.includes('__metadata:') || files.yarnrcYml.content;

    return {
      type: isBerry ? 'yarn-berry' : 'yarn-classic',
      version: isBerry ? '2+' : '1',
      content: files.yarnLock.content,
      fileName: 'yarn.lock'
    };
  }

  return { type: null, version: null, content: null, fileName: null };
}

/**
 * Check if detected lockfile matches target era.
 *
 * @param {string} detectedType - Detected lockfile type
 * @param {string} detectedVersion - Detected version
 * @param {string} targetEra - Target era key
 * @returns {boolean}
 */
function matchesTargetEra(detectedType, detectedVersion, targetEra) {
  const expectedEra = versionToEra(detectedType, detectedVersion);
  return expectedEra === targetEra;
}

/**
 * Execute mining for a single candidate.
 *
 * @param {MiningCandidate} candidate - Mining candidate
 * @param {string} outputDir - Output directory for lockfiles
 * @param {Object} [options] - Options
 * @returns {Promise<MiningResult>}
 */
export async function mineCandidate(candidate, outputDir, options = {}) {
  const result = {
    candidate,
    status: 'error'
  };

  try {
    // Step 1: Find git tag for version
    const tag = await findVersionTag(
      candidate.owner,
      candidate.repo,
      candidate.targetVersion,
      { packageName: candidate.packageName, client: options.client }
    );

    if (!tag) {
      result.status = 'tag-not-found';
      return result;
    }

    result.tagName = tag.name;

    // Step 2: Fetch lockfiles at that commit
    const historical = await fetchHistoricalLockfiles(
      candidate.owner,
      candidate.repo,
      tag.oid,
      options.client
    );

    result.commitSha = historical.commit.oid;
    result.commitDate = historical.commit.committedDate;

    // Step 3: Detect lockfile type
    const detected = detectLockfileFromFiles(historical.files);

    if (!detected.type) {
      result.status = 'no-lockfile';
      return result;
    }

    result.lockfileType = detected.type;
    result.lockfileVersion = detected.version;

    // Step 4: Verify it matches expected era
    if (!matchesTargetEra(detected.type, detected.version, candidate.targetEra)) {
      result.status = 'wrong-format';
      return result;
    }

    // Step 5: Save lockfile to disk
    const packageDir = join(
      outputDir,
      candidate.targetEra,
      candidate.packageName.replace(/\//g, '__')
    );

    const lockfilePath = join(packageDir, detected.fileName);

    // Stream large files, atomic write for smaller ones
    if (detected.content.length > MAX_MEMORY_SIZE) {
      await streamToFile(lockfilePath, detected.content);
    } else {
      await atomicWrite(lockfilePath, detected.content);
    }

    // Save metadata
    const metadata = {
      package: {
        name: candidate.packageName,
        version: candidate.targetVersion,
        versionDate: candidate.versionDate.toISOString()
      },
      repository: {
        owner: candidate.owner,
        repo: candidate.repo,
        url: `https://github.com/${candidate.owner}/${candidate.repo}`
      },
      lockfile: {
        type: detected.type,
        version: detected.version,
        path: detected.fileName,
        size: detected.content.length
      },
      commit: {
        sha: historical.commit.oid,
        date: historical.commit.committedDate,
        tag: tag.name
      },
      mining: {
        targetEra: candidate.targetEra,
        currentFormat: candidate.currentFormat,
        minedAt: new Date().toISOString()
      }
    };

    await atomicWrite(join(packageDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    // Save .yarnrc.yml if present and this is yarn-berry
    if (detected.type === 'yarn-berry' && historical.files.yarnrcYml.content) {
      await atomicWrite(
        join(packageDir, '.yarnrc.yml'),
        historical.files.yarnrcYml.content
      );
    }

    // Save package.json if present
    if (historical.files.packageJson.content) {
      await atomicWrite(
        join(packageDir, 'package.json'),
        historical.files.packageJson.content
      );
    }

    result.status = 'success';
    result.savedPath = lockfilePath;

  } catch (error) {
    result.status = 'error';
    result.error = error.message;
  }

  return result;
}

/**
 * Execute historical mining for multiple candidates.
 *
 * @param {MiningCandidate[]} candidates - Candidates to mine
 * @param {string} outputDir - Output directory
 * @param {Object} [options] - Options
 * @param {Function} [options.onProgress] - Progress callback (index, total, result)
 * @param {boolean} [options.stopOnError=false] - Stop on first error
 * @returns {Promise<MiningResult[]>}
 */
export async function executeMining(candidates, outputDir, options = {}) {
  const results = [];
  const { onProgress, stopOnError = false } = options;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    const result = await mineCandidate(candidate, outputDir, options);
    results.push(result);

    if (onProgress) {
      onProgress(i, candidates.length, result);
    }

    if (stopOnError && result.status === 'error') {
      break;
    }
  }

  return results;
}

/**
 * Summarize mining results.
 *
 * @param {MiningResult[]} results - Mining results
 * @returns {Object} Summary statistics
 */
export function summarizeResults(results) {
  const summary = {
    total: results.length,
    success: 0,
    tagNotFound: 0,
    commitNotFound: 0,
    noLockfile: 0,
    wrongFormat: 0,
    error: 0,
    byEra: {}
  };

  for (const result of results) {
    switch (result.status) {
      case 'success': summary.success++; break;
      case 'tag-not-found': summary.tagNotFound++; break;
      case 'commit-not-found': summary.commitNotFound++; break;
      case 'no-lockfile': summary.noLockfile++; break;
      case 'wrong-format': summary.wrongFormat++; break;
      case 'error': summary.error++; break;
    }

    // Track by era
    const era = result.candidate.targetEra;
    if (!summary.byEra[era]) {
      summary.byEra[era] = { success: 0, failed: 0 };
    }
    if (result.status === 'success') {
      summary.byEra[era].success++;
    } else {
      summary.byEra[era].failed++;
    }
  }

  return summary;
}

/**
 * Load existing mining state for resumability.
 *
 * @param {string} stateFile - Path to state file
 * @returns {Promise<{completed: Set<string>, results: MiningResult[]}>}
 */
export async function loadMiningState(stateFile) {
  try {
    const content = await readFile(stateFile, 'utf8');
    const data = JSON.parse(content);

    const completed = new Set(
      data.results
        .filter(r => r.status !== 'error')
        .map(r => `${r.candidate.packageName}@${r.candidate.targetEra}`)
    );

    return {
      completed,
      results: data.results
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { completed: new Set(), results: [] };
    }
    throw error;
  }
}

/**
 * Save mining state for resumability.
 *
 * @param {string} stateFile - Path to state file
 * @param {MiningResult[]} results - Mining results
 * @returns {Promise<void>}
 */
export async function saveMiningState(stateFile, results) {
  await atomicWrite(stateFile, JSON.stringify({
    savedAt: new Date().toISOString(),
    results
  }, null, 2));
}

/**
 * Execute mining with resumability support.
 *
 * @param {MiningCandidate[]} candidates - Candidates to mine
 * @param {string} outputDir - Output directory
 * @param {string} stateFile - State file for resumability
 * @param {Object} [options] - Options
 * @returns {Promise<MiningResult[]>}
 */
export async function executeMiningWithResume(candidates, outputDir, stateFile, options = {}) {
  // Load existing state
  const { completed, results: existingResults } = await loadMiningState(stateFile);

  // Filter out already completed candidates
  const remaining = candidates.filter(c =>
    !completed.has(`${c.packageName}@${c.targetEra}`)
  );

  if (remaining.length === 0) {
    console.log('All candidates already processed');
    return existingResults;
  }

  console.log(`Resuming: ${existingResults.length} done, ${remaining.length} remaining`);

  // Execute mining for remaining candidates
  const newResults = [];

  for (let i = 0; i < remaining.length; i++) {
    const candidate = remaining[i];
    const result = await mineCandidate(candidate, outputDir, options);
    newResults.push(result);

    // Save state after each result for resumability
    const allResults = [...existingResults, ...newResults];
    await saveMiningState(stateFile, allResults);

    if (options.onProgress) {
      options.onProgress(i, remaining.length, result);
    }
  }

  return [...existingResults, ...newResults];
}
