/**
 * Historical Lockfile Mining Pipeline
 *
 * This module provides tools for discovering, mining, classifying, and validating
 * lockfiles from npm high-impact packages across different lockfile version eras.
 *
 * ## Phases
 *
 * **Phase 4: Historical Lockfile Mining**
 * - Identify gaps in lockfile format coverage
 * - Find packages that existed during different lockfile eras
 * - Map package versions to git tags
 * - Fetch lockfiles at historical commits
 *
 * **Phase 5: Classification & Validation**
 * - Detect lockfile type and version
 * - Validate parsing with flatlock
 * - Generate validation reports
 *
 * @module test/discovery/lib
 *
 * @example
 * ```javascript
 * import {
 *   // Era definitions
 *   ERAS,
 *   findVersionsInEra,
 *   getEraForDate,
 *
 *   // Mining
 *   identifyGaps,
 *   findHistoricalCandidates,
 *   executeMining,
 *
 *   // Classification
 *   classifyContent,
 *   classifyFile,
 *
 *   // Validation
 *   validateContent,
 *   validateDirectory
 * } from './lib/index.js';
 *
 * // Find gaps in coverage
 * const gaps = identifyGaps(discoveryResults);
 *
 * // Create mining plan
 * const { plan } = createMiningPlan(discoveryResults, packuments);
 *
 * // Execute mining
 * const results = await executeMining(plan, outputDir);
 *
 * // Validate results
 * const { summary } = await validateDirectory(outputDir);
 * ```
 */

// Era definitions
export {
  ERAS,
  TARGET_COUNT_PER_FORMAT,
  FORMATS,
  getEraForDate,
  getAllErasForDate,
  isDateInEra,
  findVersionsInEra,
  findBestVersionForEra,
  hasVersionsInEra,
  getAlternativeEras,
  getErasForFormat,
  getHistoricalEras,
  versionToEra,
  eraToVersions
} from './eras.js';

// GitHub API and tag finding
export {
  executeGraphQL,
  generateTagPatterns,
  findVersionTag,
  findVersionTags,
  fetchHistoricalLockfiles,
  getRateLimitState,
  parseRepoUrl
} from './find-version-tags.js';

// Historical mining
export {
  identifyGaps,
  findHistoricalCandidates,
  createMiningPlan,
  mineCandidate,
  executeMining,
  summarizeResults as summarizeMiningResults,
  loadMiningState,
  saveMiningState,
  executeMiningWithResume
} from './mine-historical.js';

// Lockfile classification
export {
  classifyNpm,
  classifyPnpm,
  classifyYarn,
  classifyContent,
  classifyFile,
  classifyBatch,
  getCanonicalPath,
  summarizeClassifications,
  hasWorkspaces,
  extractWorkspaces
} from './classify-lockfiles.js';

// Validation
export {
  validateContent,
  validateFile,
  validateFiles,
  findLockfiles,
  validateDirectory,
  summarizeResults as summarizeValidationResults,
  generateReport,
  updateMetadata,
  validateAndUpdateMetadata,
  quickValidate,
  countDependencies,
  benchmarkParsing
} from './validate-lockfiles.js';

/**
 * Re-export types for documentation.
 *
 * @typedef {import('./eras.js').Era} Era
 * @typedef {import('./find-version-tags.js').TagInfo} TagInfo
 * @typedef {import('./find-version-tags.js').RateLimitState} RateLimitState
 * @typedef {import('./find-version-tags.js').GitHubClientOptions} GitHubClientOptions
 * @typedef {import('./mine-historical.js').GapAnalysis} GapAnalysis
 * @typedef {import('./mine-historical.js').MiningCandidate} MiningCandidate
 * @typedef {import('./mine-historical.js').MiningResult} MiningResult
 * @typedef {import('./classify-lockfiles.js').LockfileClassification} LockfileClassification
 * @typedef {import('./validate-lockfiles.js').ValidationResult} ValidationResult
 * @typedef {import('./validate-lockfiles.js').ValidationSummary} ValidationSummary
 */
