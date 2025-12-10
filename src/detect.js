import yaml from 'js-yaml';
import { parseSyml } from '@yarnpkg/parsers';
import yarnLockfile from '@yarnpkg/lockfile';

/**
 * @typedef {'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry'} LockfileType
 */

/**
 * Lockfile type constants
 */
export const Type = Object.freeze({
  NPM: 'npm',
  PNPM: 'pnpm',
  YARN_CLASSIC: 'yarn-classic',
  YARN_BERRY: 'yarn-berry'
});

/**
 * Try to parse content as npm package-lock.json
 * @param {string} content
 * @returns {boolean}
 */
function tryParseNpm(content) {
  try {
    const parsed = JSON.parse(content);
    // Must have lockfileVersion as a number at root level
    return typeof parsed.lockfileVersion === 'number';
  } catch {
    return false;
  }
}

/**
 * Try to parse content as yarn berry (v2+) lockfile
 * @param {string} content
 * @returns {boolean}
 */
function tryParseYarnBerry(content) {
  try {
    const parsed = parseSyml(content);
    // Must have __metadata object at root with version property
    return parsed
      && typeof parsed.__metadata === 'object'
      && parsed.__metadata !== null
      && 'version' in parsed.__metadata;
  } catch {
    return false;
  }
}

/**
 * Try to parse content as yarn classic (v1) lockfile
 * @param {string} content
 * @returns {boolean}
 */
function tryParseYarnClassic(content) {
  try {
    const parse = yarnLockfile.default?.parse || yarnLockfile.parse;
    if (!parse) return false;

    const result = parse(content);
    // Must parse successfully and NOT have __metadata (that's berry)
    // Must have at least one package entry (not empty object)
    const isValidResult = result.type === 'success' || result.type === 'merge';
    const hasEntries = result.object && Object.keys(result.object).length > 0;
    const notBerry = !('__metadata' in result.object);

    return isValidResult && hasEntries && notBerry;
  } catch {
    return false;
  }
}

/**
 * Try to parse content as pnpm lockfile
 * @param {string} content
 * @returns {boolean}
 */
function tryParsePnpm(content) {
  try {
    const parsed = yaml.load(content);
    // Must have lockfileVersion at root and NOT have __metadata
    return parsed
      && typeof parsed === 'object'
      && 'lockfileVersion' in parsed
      && !('__metadata' in parsed);
  } catch {
    return false;
  }
}

/**
 * Detect lockfile type from content and/or path
 *
 * Content is the primary signal - we actually parse the content to verify
 * it's a valid lockfile of the detected type. This prevents spoofing attacks
 * where malicious content contains detection markers in strings/comments.
 *
 * Path is only used as a fallback hint when content is not provided.
 *
 * @param {Object} options - Detection options
 * @param {string} [options.path] - Path to the lockfile (optional hint)
 * @param {string} [options.content] - Lockfile content (primary signal)
 * @returns {LockfileType}
 * @throws {Error} If unable to detect lockfile type
 */
export function detectType({ path, content } = {}) {
  // Content-based detection (primary) - actually parse to verify type
  if (content) {
    // npm: valid JSON with lockfileVersion number at root
    if (tryParseNpm(content)) {
      return Type.NPM;
    }

    // yarn berry: valid YAML with __metadata.version at root
    if (tryParseYarnBerry(content)) {
      return Type.YARN_BERRY;
    }

    // yarn classic: parses with @yarnpkg/lockfile, no __metadata
    if (tryParseYarnClassic(content)) {
      return Type.YARN_CLASSIC;
    }

    // pnpm: valid YAML with lockfileVersion at root, no __metadata
    if (tryParsePnpm(content)) {
      return Type.PNPM;
    }
  }

  // If content was provided but didn't match any format, that's an error
  // Don't fall back to path-based detection with invalid content (security risk)
  if (content) {
    throw new Error('Unable to detect lockfile type: content does not match any known format');
  }

  // Path-based detection (only when no content provided)
  if (path) {
    if (path.endsWith('package-lock.json') || path.endsWith('npm-shrinkwrap.json')) {
      return Type.NPM;
    }
    if (path.endsWith('pnpm-lock.yaml')) {
      return Type.PNPM;
    }
    if (path.endsWith('yarn.lock')) {
      // Without content, default to classic (more common historically)
      return Type.YARN_CLASSIC;
    }
  }

  throw new Error('Unable to detect lockfile type');
}
