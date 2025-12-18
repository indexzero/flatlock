/**
 * @fileoverview Core utilities for the discovery pipeline
 * Following Matteo Collina's Node.js patterns:
 * - Atomic file operations
 * - Exponential backoff retries
 * - Proper stream handling
 */

import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write data to a file atomically
 * Writes to a .tmp file first, then renames to target path
 * This prevents partial writes and ensures data integrity
 *
 * @param {string} filePath - Target file path
 * @param {string|Buffer} data - Data to write
 * @returns {Promise<void>}
 */
export async function atomicWriteFile(filePath, data) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Write JSON data to a file atomically
 *
 * @param {string} filePath - Target file path
 * @param {unknown} data - Data to serialize as JSON
 * @param {number} [indent=2] - JSON indentation
 * @returns {Promise<void>}
 */
export async function atomicWriteJSON(filePath, data, indent = 2) {
  const json = JSON.stringify(data, null, indent);
  await atomicWriteFile(filePath, json + '\n');
}

/**
 * Delay execution for a specified duration
 *
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @typedef {Object} RetryOptions
 * @property {number} [retries=3] - Number of retry attempts
 * @property {number} [minTimeout=1000] - Minimum delay between retries (ms)
 * @property {number} [maxTimeout=10000] - Maximum delay between retries (ms)
 * @property {number} [factor=2] - Exponential backoff factor
 * @property {(err: Error, attempt: number) => boolean} [shouldRetry] - Function to determine if retry should occur
 */

/**
 * Retry a function with exponential backoff
 * Suitable for network operations that may transiently fail
 *
 * @template T
 * @param {() => Promise<T>} fn - Function to retry
 * @param {RetryOptions} [options={}] - Retry options
 * @returns {Promise<T>}
 */
export async function retry(fn, options = {}) {
  const {
    retries = 3,
    minTimeout = 1000,
    maxTimeout = 10000,
    factor = 2,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError;
  let timeout = minTimeout;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt > retries || !shouldRetry(err, attempt)) {
        throw err;
      }

      progress(`Retry ${attempt}/${retries} after ${timeout}ms: ${err.message}`);
      await delay(timeout);

      // Exponential backoff with jitter
      timeout = Math.min(maxTimeout, timeout * factor + Math.random() * 100);
    }
  }

  throw lastError;
}

/**
 * Default retry condition - retry on network errors and 5xx status codes
 *
 * @param {Error & {code?: string, status?: number}} err - Error to evaluate
 * @returns {boolean} - Whether to retry
 */
function defaultShouldRetry(err) {
  // Retry on network errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return true;
  }

  // Retry on server errors (5xx)
  if (err.status && err.status >= 500 && err.status < 600) {
    return true;
  }

  // Retry on rate limiting (429)
  if (err.status === 429) {
    return true;
  }

  return false;
}

/**
 * Write a progress message to stderr
 * Does not interfere with stdout data output
 *
 * @param {...unknown} args - Arguments to log
 */
export function progress(...args) {
  const timestamp = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${timestamp}] ${args.join(' ')}\n`);
}

/**
 * Create a simple progress counter for batch operations
 *
 * @param {string} label - Operation label
 * @param {number} total - Total items
 * @returns {{increment: () => void, done: () => void}}
 */
export function createProgressCounter(label, total) {
  let count = 0;
  const startTime = Date.now();

  return {
    increment() {
      count++;
      if (count % 10 === 0 || count === total) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        progress(`${label}: ${count}/${total} (${elapsed}s)`);
      }
    },
    done() {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      progress(`${label}: completed ${count}/${total} in ${elapsed}s`);
    },
  };
}

/**
 * Parse a GitHub repository URL and extract owner/name
 *
 * @param {string} url - Repository URL in various formats
 * @returns {{owner: string, name: string} | null}
 */
export function parseGitHubUrl(url) {
  if (!url) return null;

  // Handle various formats:
  // - git+https://github.com/owner/repo.git
  // - https://github.com/owner/repo
  // - git://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#?]|$)/);

  if (!match) return null;

  return {
    owner: match[1],
    name: match[2].replace(/\.git$/, ''),
  };
}

/**
 * Batch an array into chunks
 *
 * @template T
 * @param {T[]} array - Array to batch
 * @param {number} size - Chunk size
 * @returns {T[][]}
 */
export function batch(array, size) {
  const batches = [];
  for (let i = 0; i < array.length; i += size) {
    batches.push(array.slice(i, i + size));
  }
  return batches;
}
