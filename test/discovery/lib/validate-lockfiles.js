/**
 * Lockfile Validation with flatlock
 *
 * Validates that discovered/mined lockfiles can be parsed correctly
 * using the flatlock library.
 *
 * @module test/discovery/lib/validate-lockfiles
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { classifyContent, classifyFile } from './classify-lockfiles.js';

// Import flatlock from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..', '..');

// Dynamic import to handle potential issues
let flatlock;
try {
  flatlock = await import(join(projectRoot, 'src', 'index.js'));
} catch (error) {
  console.error('Failed to import flatlock:', error.message);
  throw error;
}

const { fromString, tryFromString, detectType, Type } = flatlock;

/**
 * @typedef {Object} ValidationResult
 * @property {string} path - File path
 * @property {boolean} success - Whether parsing succeeded
 * @property {string|null} type - Detected lockfile type
 * @property {string|number|null} version - Lockfile version
 * @property {number} depCount - Number of dependencies parsed
 * @property {number} parseTimeMs - Parse time in milliseconds
 * @property {string|null} error - Error message if failed
 * @property {string[]} sampleDeps - Sample of parsed dependencies
 */

/**
 * @typedef {Object} ValidationSummary
 * @property {number} total - Total files validated
 * @property {number} passed - Files that parsed successfully
 * @property {number} failed - Files that failed to parse
 * @property {Object<string, {passed: number, failed: number}>} byType - Results by lockfile type
 * @property {number} totalDeps - Total dependencies across all files
 * @property {number} avgParseTimeMs - Average parse time
 */

/**
 * Validate a single lockfile with flatlock.
 *
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Options
 * @param {string} [options.path] - File path for detection hint
 * @param {number} [options.sampleSize=5] - Number of sample deps to include
 * @returns {ValidationResult}
 */
export function validateContent(content, options = {}) {
  const { path = 'unknown', sampleSize = 5 } = options;
  const result = {
    path,
    success: false,
    type: null,
    version: null,
    depCount: 0,
    parseTimeMs: 0,
    error: null,
    sampleDeps: []
  };

  // First classify to get type and version
  const classification = classifyContent(content, { path });
  result.type = classification.type;
  result.version = classification.version;

  if (classification.type === 'unknown' || !classification.valid) {
    result.error = 'Unable to classify lockfile type';
    return result;
  }

  // Try to parse with flatlock
  const startTime = performance.now();

  try {
    const parseResult = tryFromString(content, { path });

    if (!parseResult.ok) {
      result.error = parseResult.error?.message || 'Parse failed';
      result.parseTimeMs = performance.now() - startTime;
      return result;
    }

    // Collect dependencies
    const deps = [];
    for (const dep of parseResult.value) {
      deps.push(dep);
    }

    result.parseTimeMs = performance.now() - startTime;
    result.depCount = deps.length;
    result.success = true;

    // Get sample deps
    result.sampleDeps = deps
      .slice(0, sampleSize)
      .map(d => `${d.name}@${d.version}`);

  } catch (error) {
    result.parseTimeMs = performance.now() - startTime;
    result.error = error.message;
  }

  return result;
}

/**
 * Validate a lockfile from disk.
 *
 * @param {string} filePath - Path to lockfile
 * @param {Object} [options] - Options
 * @returns {Promise<ValidationResult>}
 */
export async function validateFile(filePath, options = {}) {
  try {
    const content = await readFile(filePath, 'utf8');
    return validateContent(content, { ...options, path: filePath });
  } catch (error) {
    return {
      path: filePath,
      success: false,
      type: null,
      version: null,
      depCount: 0,
      parseTimeMs: 0,
      error: `Failed to read file: ${error.message}`,
      sampleDeps: []
    };
  }
}

/**
 * Validate multiple lockfiles.
 *
 * @param {string[]} filePaths - Paths to lockfiles
 * @param {Object} [options] - Options
 * @param {Function} [options.onProgress] - Progress callback (index, total, result)
 * @returns {Promise<ValidationResult[]>}
 */
export async function validateFiles(filePaths, options = {}) {
  const results = [];
  const { onProgress } = options;

  for (let i = 0; i < filePaths.length; i++) {
    const result = await validateFile(filePaths[i], options);
    results.push(result);

    if (onProgress) {
      onProgress(i, filePaths.length, result);
    }
  }

  return results;
}

/**
 * Find all lockfiles in a directory recursively.
 *
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Paths to lockfiles
 */
export async function findLockfiles(dir) {
  const lockfiles = [];
  const lockfileNames = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock'
  ];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          await walk(fullPath);
        }
      } else if (lockfileNames.includes(entry.name)) {
        lockfiles.push(fullPath);
      }
    }
  }

  await walk(dir);
  return lockfiles;
}

/**
 * Validate all lockfiles in a directory.
 *
 * @param {string} dir - Directory to validate
 * @param {Object} [options] - Options
 * @returns {Promise<{results: ValidationResult[], summary: ValidationSummary}>}
 */
export async function validateDirectory(dir, options = {}) {
  const lockfiles = await findLockfiles(dir);
  const results = await validateFiles(lockfiles, options);
  const summary = summarizeResults(results);

  return { results, summary };
}

/**
 * Summarize validation results.
 *
 * @param {ValidationResult[]} results - Validation results
 * @returns {ValidationSummary}
 */
export function summarizeResults(results) {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    byType: {},
    totalDeps: 0,
    avgParseTimeMs: 0
  };

  let totalParseTime = 0;

  for (const result of results) {
    if (result.success) {
      summary.passed++;
    } else {
      summary.failed++;
    }

    summary.totalDeps += result.depCount;
    totalParseTime += result.parseTimeMs;

    // Track by type
    const type = result.type || 'unknown';
    if (!summary.byType[type]) {
      summary.byType[type] = { passed: 0, failed: 0 };
    }
    if (result.success) {
      summary.byType[type].passed++;
    } else {
      summary.byType[type].failed++;
    }
  }

  summary.avgParseTimeMs = results.length > 0
    ? totalParseTime / results.length
    : 0;

  return summary;
}

/**
 * Generate a validation report.
 *
 * @param {ValidationResult[]} results - Validation results
 * @param {Object} [options] - Options
 * @param {string} [options.baseDir] - Base directory for relative paths
 * @returns {string} Markdown report
 */
export function generateReport(results, options = {}) {
  const { baseDir = '.' } = options;
  const summary = summarizeResults(results);

  let report = `# Lockfile Validation Report\n\n`;
  report += `Generated: ${new Date().toISOString()}\n\n`;

  // Summary
  report += `## Summary\n\n`;
  report += `- **Total**: ${summary.total}\n`;
  report += `- **Passed**: ${summary.passed} (${((summary.passed / summary.total) * 100).toFixed(1)}%)\n`;
  report += `- **Failed**: ${summary.failed}\n`;
  report += `- **Total Dependencies**: ${summary.totalDeps.toLocaleString()}\n`;
  report += `- **Avg Parse Time**: ${summary.avgParseTimeMs.toFixed(2)}ms\n\n`;

  // By type
  report += `## Results by Type\n\n`;
  report += `| Type | Passed | Failed | Total |\n`;
  report += `|------|--------|--------|-------|\n`;

  for (const [type, counts] of Object.entries(summary.byType)) {
    const total = counts.passed + counts.failed;
    report += `| ${type} | ${counts.passed} | ${counts.failed} | ${total} |\n`;
  }

  report += `\n`;

  // Failed files
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    report += `## Failed Files\n\n`;
    for (const result of failed) {
      const relPath = baseDir ? relative(baseDir, result.path) : result.path;
      report += `### ${relPath}\n\n`;
      report += `- **Type**: ${result.type || 'unknown'}\n`;
      report += `- **Error**: ${result.error}\n\n`;
    }
  }

  // Successful files (just counts)
  const passed = results.filter(r => r.success);
  if (passed.length > 0) {
    report += `## Successful Files\n\n`;
    report += `| File | Type | Version | Deps | Time (ms) |\n`;
    report += `|------|------|---------|------|-----------|\n`;

    for (const result of passed) {
      const relPath = baseDir ? relative(baseDir, result.path) : result.path;
      report += `| ${relPath} | ${result.type} | ${result.version} | ${result.depCount} | ${result.parseTimeMs.toFixed(1)} |\n`;
    }
  }

  return report;
}

/**
 * Update metadata.json files with validation results.
 *
 * @param {ValidationResult[]} results - Validation results
 * @returns {Promise<number>} Number of metadata files updated
 */
export async function updateMetadata(results) {
  let updated = 0;

  for (const result of results) {
    const dir = dirname(result.path);
    const metadataPath = join(dir, 'metadata.json');

    try {
      // Check if metadata.json exists
      await stat(metadataPath);

      // Read existing metadata
      const content = await readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      // Update flatlock section
      metadata.flatlock = {
        parsed: result.success,
        depCount: result.depCount,
        parseTimeMs: Math.round(result.parseTimeMs),
        error: result.error,
        validatedAt: new Date().toISOString()
      };

      // Write back
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      updated++;
    } catch (error) {
      // Skip if no metadata.json exists
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to update ${metadataPath}: ${error.message}`);
      }
    }
  }

  return updated;
}

/**
 * Validate lockfiles and update their metadata.
 *
 * @param {string} dir - Directory containing lockfiles
 * @param {Object} [options] - Options
 * @returns {Promise<{results: ValidationResult[], summary: ValidationSummary, metadataUpdated: number}>}
 */
export async function validateAndUpdateMetadata(dir, options = {}) {
  const { results, summary } = await validateDirectory(dir, options);
  const metadataUpdated = await updateMetadata(results);

  return { results, summary, metadataUpdated };
}

/**
 * Quick validation check - just returns pass/fail.
 *
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Options
 * @returns {boolean}
 */
export function quickValidate(content, options = {}) {
  try {
    const result = tryFromString(content, options);
    if (!result.ok) return false;

    // Try to consume at least one dependency
    for (const dep of result.value) {
      return true; // At least one dep parsed
    }

    return true; // Empty lockfile is technically valid
  } catch {
    return false;
  }
}

/**
 * Count dependencies without storing them.
 * More memory efficient for large lockfiles.
 *
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Options
 * @returns {{count: number, error: string|null}}
 */
export function countDependencies(content, options = {}) {
  try {
    const result = tryFromString(content, options);
    if (!result.ok) {
      return { count: 0, error: result.error?.message };
    }

    let count = 0;
    for (const _ of result.value) {
      count++;
    }

    return { count, error: null };
  } catch (error) {
    return { count: 0, error: error.message };
  }
}

/**
 * Benchmark parsing performance for a lockfile.
 *
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Options
 * @param {number} [options.iterations=10] - Number of iterations
 * @returns {{min: number, max: number, avg: number, std: number}}
 */
export function benchmarkParsing(content, options = {}) {
  const { iterations = 10, path = 'benchmark' } = options;
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();

    try {
      const result = tryFromString(content, { path });
      if (result.ok) {
        // Consume all dependencies
        for (const _ of result.value) {
          // noop
        }
      }
    } catch {
      // Ignore errors in benchmark
    }

    times.push(performance.now() - start);
  }

  // Calculate statistics
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const variance = times.reduce((acc, t) => acc + Math.pow(t - avg, 2), 0) / times.length;
  const std = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    std,
    iterations
  };
}
