/**
 * Lockfile Version Era Definitions
 *
 * This module defines the time periods when different lockfile formats and versions
 * were in common use. Used for historical lockfile mining to find packages that
 * existed during specific eras.
 *
 * @module test/discovery/lib/eras
 */

/**
 * @typedef {Object} Era
 * @property {Date} start - Start of the era (inclusive)
 * @property {Date} end - End of the era (exclusive)
 * @property {string} format - Parent lockfile format (npm, pnpm, yarn-classic, yarn-berry)
 * @property {string} description - Human-readable description
 */

/**
 * Lockfile version eras with date ranges.
 * Dates are approximate based on when package manager versions were released.
 *
 * @type {Record<string, Era>}
 */
export const ERAS = Object.freeze({
  // npm lockfile versions
  'npm-v1': {
    start: new Date('2017-01-01'),
    end: new Date('2020-06-01'),
    format: 'npm',
    description: 'npm 5.x-6.x era with lockfileVersion: 1'
  },
  'npm-v2': {
    start: new Date('2020-06-01'),
    end: new Date('2021-10-01'),
    format: 'npm',
    description: 'npm 7.x era with lockfileVersion: 2 (transitional)'
  },
  'npm-v3': {
    start: new Date('2021-10-01'),
    end: new Date('2099-01-01'),
    format: 'npm',
    description: 'npm 8.x+ era with lockfileVersion: 3 (packages only)'
  },

  // pnpm lockfile versions
  'pnpm-shrinkwrap': {
    start: new Date('2017-01-01'),
    end: new Date('2019-01-01'),
    format: 'pnpm',
    description: 'pnpm 1.x-2.x era with shrinkwrapVersion'
  },
  'pnpm-v5': {
    start: new Date('2019-01-01'),
    end: new Date('2023-01-01'),
    format: 'pnpm',
    description: 'pnpm 5.x-7.x era with lockfileVersion: 5.x (number)'
  },
  'pnpm-v6': {
    start: new Date('2023-01-01'),
    end: new Date('2024-01-01'),
    format: 'pnpm',
    description: 'pnpm 8.x era with lockfileVersion: "6.x" (string)'
  },
  'pnpm-v9': {
    start: new Date('2024-01-01'),
    end: new Date('2099-01-01'),
    format: 'pnpm',
    description: 'pnpm 9.x era with lockfileVersion: "9.0" (string)'
  },

  // yarn lockfile versions
  'yarn-classic': {
    start: new Date('2016-01-01'),
    end: new Date('2020-06-01'),
    format: 'yarn-classic',
    description: 'yarn 1.x era with "# yarn lockfile v1" header'
  },
  'yarn-berry': {
    start: new Date('2020-06-01'),
    end: new Date('2099-01-01'),
    format: 'yarn-berry',
    description: 'yarn 2.x-4.x era with __metadata section'
  }
});

/**
 * Get the era key for a given date.
 * Returns the most likely era for packages published on that date.
 *
 * @param {Date} date - Publication date
 * @param {string} [format] - Optional format hint (npm, pnpm, yarn-classic, yarn-berry)
 * @returns {string|null} Era key or null if no matching era
 */
export function getEraForDate(date, format = null) {
  const timestamp = date.getTime();

  for (const [eraKey, era] of Object.entries(ERAS)) {
    // Filter by format if specified
    if (format && era.format !== format) continue;

    if (timestamp >= era.start.getTime() && timestamp < era.end.getTime()) {
      return eraKey;
    }
  }

  return null;
}

/**
 * Get all possible eras for a given date (multiple formats may apply).
 *
 * @param {Date} date - Publication date
 * @returns {string[]} Array of era keys
 */
export function getAllErasForDate(date) {
  const timestamp = date.getTime();
  const eras = [];

  for (const [eraKey, era] of Object.entries(ERAS)) {
    if (timestamp >= era.start.getTime() && timestamp < era.end.getTime()) {
      eras.push(eraKey);
    }
  }

  return eras;
}

/**
 * Check if a date falls within a specific era.
 *
 * @param {Date} date - Date to check
 * @param {string} eraKey - Era key (e.g., 'npm-v1', 'yarn-classic')
 * @returns {boolean}
 */
export function isDateInEra(date, eraKey) {
  const era = ERAS[eraKey];
  if (!era) return false;

  const timestamp = date.getTime();
  return timestamp >= era.start.getTime() && timestamp < era.end.getTime();
}

/**
 * Find versions from a packument that were published during a specific era.
 *
 * @param {Object} packument - npm packument with time field
 * @param {string} eraKey - Era key to search for
 * @returns {Array<{version: string, timestamp: Date}>}
 */
export function findVersionsInEra(packument, eraKey) {
  const era = ERAS[eraKey];
  if (!era || !packument.time) return [];

  const versions = [];
  for (const [version, timestamp] of Object.entries(packument.time)) {
    // Skip metadata entries
    if (version === 'created' || version === 'modified') continue;

    const date = new Date(timestamp);
    if (date.getTime() >= era.start.getTime() && date.getTime() < era.end.getTime()) {
      versions.push({ version, timestamp: date });
    }
  }

  // Sort by timestamp ascending
  return versions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Find the best version from a packument for a specific era.
 * Prefers the latest stable version within the era.
 *
 * @param {Object} packument - npm packument with time field
 * @param {string} eraKey - Era key
 * @returns {{version: string, timestamp: Date}|null}
 */
export function findBestVersionForEra(packument, eraKey) {
  const versions = findVersionsInEra(packument, eraKey);
  if (versions.length === 0) return null;

  // Filter out prerelease versions if possible
  const stable = versions.filter(v =>
    !v.version.includes('-') &&
    !v.version.includes('alpha') &&
    !v.version.includes('beta') &&
    !v.version.includes('rc')
  );

  // Prefer latest stable, fall back to latest overall
  const candidates = stable.length > 0 ? stable : versions;
  return candidates[candidates.length - 1];
}

/**
 * Check if a packument has any versions in a specific era.
 *
 * @param {Object} packument - npm packument with time field
 * @param {string} eraKey - Era key
 * @returns {boolean}
 */
export function hasVersionsInEra(packument, eraKey) {
  return findVersionsInEra(packument, eraKey).length > 0;
}

/**
 * Get eras that are different from the current detected format.
 * Used to find historical eras to mine.
 *
 * @param {string} currentFormat - Current lockfile format (npm, pnpm, yarn-classic, yarn-berry)
 * @returns {string[]} Era keys that don't match the current format
 */
export function getAlternativeEras(currentFormat) {
  return Object.entries(ERAS)
    .filter(([_, era]) => era.format !== currentFormat)
    .map(([key]) => key);
}

/**
 * Get eras for a specific format (e.g., all npm eras).
 *
 * @param {string} format - Lockfile format
 * @returns {string[]} Era keys for that format
 */
export function getErasForFormat(format) {
  return Object.entries(ERAS)
    .filter(([_, era]) => era.format === format)
    .map(([key]) => key);
}

/**
 * Get historical (non-current) eras for a specific format.
 * Excludes eras that end at 2099 (current/ongoing).
 *
 * @param {string} format - Lockfile format
 * @returns {string[]} Historical era keys for that format
 */
export function getHistoricalEras(format = null) {
  const cutoff = new Date('2099-01-01').getTime();

  return Object.entries(ERAS)
    .filter(([_, era]) => {
      const isHistorical = era.end.getTime() < cutoff;
      const matchesFormat = !format || era.format === format;
      return isHistorical && matchesFormat;
    })
    .map(([key]) => key);
}

/**
 * Map from lockfile version to era key.
 *
 * @param {string} format - Lockfile format (npm, pnpm, yarn-classic, yarn-berry)
 * @param {string|number} version - Lockfile version
 * @returns {string|null} Era key or null
 */
export function versionToEra(format, version) {
  const versionStr = String(version);

  switch (format) {
    case 'npm':
      if (versionStr === '1') return 'npm-v1';
      if (versionStr === '2') return 'npm-v2';
      if (versionStr === '3') return 'npm-v3';
      break;
    case 'pnpm':
      if (versionStr.startsWith('3') || versionStr.startsWith('4')) return 'pnpm-shrinkwrap';
      if (versionStr.startsWith('5')) return 'pnpm-v5';
      if (versionStr.startsWith('6')) return 'pnpm-v6';
      if (versionStr.startsWith('9')) return 'pnpm-v9';
      break;
    case 'yarn-classic':
      return 'yarn-classic';
    case 'yarn-berry':
      return 'yarn-berry';
  }

  return null;
}

/**
 * Get the lockfile version(s) associated with an era.
 *
 * @param {string} eraKey - Era key
 * @returns {Array<string|number>} Lockfile versions
 */
export function eraToVersions(eraKey) {
  const mapping = {
    'npm-v1': [1],
    'npm-v2': [2],
    'npm-v3': [3],
    'pnpm-shrinkwrap': [3, 4],
    'pnpm-v5': ['5.3', '5.4'],
    'pnpm-v6': ['6.0', '6.1'],
    'pnpm-v9': ['9.0'],
    'yarn-classic': [1],
    'yarn-berry': [6, 8] // __metadata version
  };

  return mapping[eraKey] || [];
}

/**
 * Default target count per format for test coverage.
 */
export const TARGET_COUNT_PER_FORMAT = 15;

/**
 * All supported lockfile formats.
 */
export const FORMATS = Object.freeze(['npm', 'pnpm', 'yarn-classic', 'yarn-berry']);
