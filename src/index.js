import { readFile } from 'node:fs/promises';
import { detectType, Type } from './detect.js';
import {
  fromPackageLock,
  fromPnpmLock,
  fromYarnBerryLock,
  fromYarnClassicLock
} from './parsers/index.js';
import { Err, Ok } from './result.js';

/** @typedef {import('./detect.js').LockfileType} LockfileType */
/** @typedef {import('./parsers/npm.js').Dependency} Dependency */

/**
 * @typedef {Object} ParseOptions
 * @property {string} [path] - Path hint for type detection
 * @property {LockfileType} [type] - Explicit type (skip detection)
 */

// Re-export Type and detection
export { Type, detectType };

// Re-export Result helpers
export { Ok, Err };

// Re-export individual parsers
export { fromPackageLock, fromPnpmLock, fromYarnClassicLock, fromYarnBerryLock };

/**
 * Parse lockfile from path (auto-detect type)
 * @param {string} path - Path to lockfile
 * @param {Object} [options] - Parser options
 * @returns {AsyncGenerator<Dependency>}
 */
export async function* fromPath(path, options = {}) {
  const content = await readFile(path, 'utf8');
  const type = detectType({ path, content });

  yield* fromString(content, { ...options, path, type });
}

/**
 * Parse lockfile from string (auto-detect or use options.type)
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Parser options
 * @param {string} [options.path] - Path hint for type detection
 * @param {LockfileType} [options.type] - Explicit type (skip detection)
 * @returns {Generator<Dependency>}
 */
export function* fromString(content, options = {}) {
  const type = options.type || detectType({ path: options.path, content });

  switch (type) {
    case Type.NPM: {
      yield* fromPackageLock(content, options);
      break;
    }
    case Type.PNPM: {
      yield* fromPnpmLock(content, options);
      break;
    }
    case Type.YARN_CLASSIC: {
      yield* fromYarnClassicLock(content, options);
      break;
    }
    case Type.YARN_BERRY: {
      yield* fromYarnBerryLock(content, options);
      break;
    }
    default: {
      throw new Error(`Unknown lockfile type: ${type}`);
    }
  }
}

/**
 * Try to parse lockfile from path (returns Result)
 * @param {string} path - Path to lockfile
 * @param {ParseOptions} [options] - Parser options
 * @returns {Promise<import('./result.js').Result<AsyncGenerator<Dependency>>>}
 */
export async function tryFromPath(path, options = {}) {
  try {
    const generator = fromPath(path, options);
    return Ok(generator);
  } catch (err) {
    return Err(/** @type {Error} */ (err));
  }
}

/**
 * Try to parse lockfile from string (returns Result)
 * @param {string} content - Lockfile content
 * @param {ParseOptions} [options] - Parser options
 * @returns {import('./result.js').Result<Generator<Dependency>>}
 */
export function tryFromString(content, options = {}) {
  try {
    // Eagerly detect type before creating generator to catch detection errors
    const type = options.type || detectType({ path: options.path, content });
    const generator = fromString(content, { ...options, type });
    return Ok(generator);
  } catch (err) {
    return Err(/** @type {Error} */ (err));
  }
}

/**
 * Parse yarn.lock (auto-detect classic vs berry)
 * @param {string} content - Lockfile content
 * @param {Object} [options] - Parser options
 * @returns {Generator<Dependency>}
 */
export function* fromYarnLock(content, options = {}) {
  // Auto-detect classic vs berry
  const isBerry = content.includes('__metadata');
  if (isBerry) {
    yield* fromYarnBerryLock(content, options);
  } else {
    yield* fromYarnClassicLock(content, options);
  }
}

/**
 * Collect all dependencies into an array
 * @param {string} pathOrContent - Path to lockfile or content string
 * @param {Object} [options] - Parser options
 * @returns {Promise<Dependency[]>}
 */
export async function collect(pathOrContent, options = {}) {
  const deps = [];

  // Check if it's a path or content
  const isPath = !pathOrContent.includes('\n') && !pathOrContent.startsWith('{');

  if (isPath) {
    for await (const dep of fromPath(pathOrContent, options)) {
      deps.push(dep);
    }
  } else {
    for (const dep of fromString(pathOrContent, options)) {
      deps.push(dep);
    }
  }

  return deps;
}

// Re-export lockfile key parsing utilities
export {
  parseNpmKey,
  parsePnpmKey,
  parseYarnBerryKey,
  parseYarnClassicKey
} from './parsers/index.js';
