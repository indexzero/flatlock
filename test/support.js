/**
 * Test support utilities
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

/**
 * Load a test fixture file (base64 decoded)
 * Fixtures are stored base64 encoded to avoid dependabot/GitHub security warnings
 * @param {string} relativePath - Path relative to test/fixtures (e.g., 'npm/package-lock.json.v2')
 * @returns {string} Decoded fixture content
 */
export function loadFixture(relativePath) {
  const fullPath = join(fixturesDir, relativePath);
  const encoded = readFileSync(fullPath, 'utf8');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

/**
 * Get the full path to a fixture file
 * @param {string} relativePath - Path relative to test/fixtures
 * @returns {string} Full path
 */
export function fixturePath(relativePath) {
  return join(fixturesDir, relativePath);
}

/**
 * Compare two sets of dependencies and return accuracy metrics
 * @param {Set<string>} expected - Ground truth package specs
 * @param {Set<string>} actual - Our parser's output
 * @returns {{ accuracy: number, onlyInExpected: string[], onlyInActual: string[], intersection: number }}
 */
export function compareResults(expected, actual) {
  const onlyInExpected = [...expected].filter(p => !actual.has(p));
  const onlyInActual = [...actual].filter(p => !expected.has(p));
  const intersection = [...expected].filter(p => actual.has(p)).length;

  const total = Math.max(expected.size, actual.size);
  const diff = onlyInExpected.length + onlyInActual.length;
  const accuracy = total > 0 ? (total - diff) / total : 1;

  return { accuracy, onlyInExpected, onlyInActual, intersection };
}

/**
 * Convert dependency to spec string for comparison
 * @param {{ name: string, version: string }} dep
 * @returns {string}
 */
export function toSpec(dep) {
  return `${dep.name}@${dep.version}`;
}

/**
 * Format accuracy as percentage string
 * @param {number} accuracy - Accuracy between 0 and 1
 * @returns {string}
 */
export function formatAccuracy(accuracy) {
  return `${(accuracy * 100).toFixed(2)}%`;
}

/**
 * Log comparison results in a consistent format
 * @param {string} label - Description of comparison
 * @param {number} expectedCount - Ground truth count
 * @param {number} actualCount - Our parser count
 * @param {{ accuracy: number, onlyInExpected: string[], onlyInActual: string[] }} results
 */
export function logComparison(label, expectedCount, actualCount, results) {
  console.log(`\n${label}`);
  console.log(`  Ground truth: ${expectedCount} packages`);
  console.log(`  Our parser:   ${actualCount} packages`);
  console.log(`  Accuracy:     ${formatAccuracy(results.accuracy)}`);

  if (results.onlyInExpected.length > 0) {
    console.log(
      `  Missing (${results.onlyInExpected.length}):`,
      results.onlyInExpected.slice(0, 3).join(', ')
    );
  }
  if (results.onlyInActual.length > 0) {
    console.log(
      `  Extra (${results.onlyInActual.length}):`,
      results.onlyInActual.slice(0, 3).join(', ')
    );
  }
}
