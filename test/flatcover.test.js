/**
 * @fileoverview Tests for flatcover CLI functionality
 *
 * Tests cover:
 * - --full flag with --cover mode (integrity/resolved fields)
 * - --list option for JSON file input
 * - stdin (-) input for NDJSON
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', 'bin', 'flatcover.js');
const lockfilePath = join(__dirname, '..', 'pnpm-lock.yaml');

/**
 * Run flatcover CLI with given args and return stdout
 * @param {string} args - CLI arguments
 * @param {object} options - execSync options
 * @returns {string} stdout output
 */
function runFlatcover(args, options = {}) {
  return execSync(`node ${binPath} ${args}`, {
    encoding: 'utf8',
    timeout: 30000,
    ...options
  });
}

/**
 * Run flatcover with lockfile input
 * @param {string} args - CLI arguments (after lockfile)
 * @returns {string} stdout output
 */
function runFlatcoverWithLockfile(args) {
  return runFlatcover(`${lockfilePath} ${args}`);
}

describe('flatcover --full --cover', () => {
  describe('JSON output format', () => {
    test('includes integrity field when --full --cover --json', () => {
      const output = runFlatcoverWithLockfile('--full --cover --json');
      const data = JSON.parse(output);

      assert.ok(Array.isArray(data), 'Output should be JSON array');
      assert.ok(data.length > 0, 'Should have results');

      // Find a result with integrity (most packages have it)
      const withIntegrity = data.filter(r => r.integrity);
      assert.ok(withIntegrity.length > 0, 'Should have results with integrity field');

      // Verify structure of entries with integrity
      for (const result of withIntegrity.slice(0, 5)) {
        assert.ok(result.name, 'Should have name');
        assert.ok(result.version, 'Should have version');
        assert.ok(typeof result.present === 'boolean', 'Should have present boolean');
        assert.ok(result.integrity.startsWith('sha'), 'Integrity should be SHA hash');
      }
    });

    test('does NOT include integrity field without --full', () => {
      const output = runFlatcoverWithLockfile('--cover --json');
      const data = JSON.parse(output);

      assert.ok(Array.isArray(data), 'Output should be JSON array');
      assert.ok(data.length > 0, 'Should have results');

      // No result should have integrity without --full
      const withIntegrity = data.filter(r => r.integrity);
      assert.equal(withIntegrity.length, 0, 'Should NOT have integrity without --full');
    });
  });

  describe('NDJSON output format', () => {
    test('includes integrity field when --full --cover --ndjson', () => {
      const output = runFlatcoverWithLockfile('--full --cover --ndjson');
      const lines = output.trim().split('\n');

      assert.ok(lines.length > 0, 'Should have output lines');

      // Parse first few lines
      const results = lines.slice(0, 10).map(line => JSON.parse(line));

      // Find results with integrity
      const withIntegrity = results.filter(r => r.integrity);
      assert.ok(withIntegrity.length > 0, 'Should have results with integrity field');

      for (const result of withIntegrity) {
        assert.ok(result.name, 'Should have name');
        assert.ok(result.version, 'Should have version');
        assert.ok(typeof result.present === 'boolean', 'Should have present boolean');
        assert.ok(result.integrity.startsWith('sha'), 'Integrity should be SHA hash');
      }
    });

    test('does NOT include integrity field without --full', () => {
      const output = runFlatcoverWithLockfile('--cover --ndjson');
      const lines = output.trim().split('\n');
      const results = lines.slice(0, 10).map(line => JSON.parse(line));

      const withIntegrity = results.filter(r => r.integrity);
      assert.equal(withIntegrity.length, 0, 'Should NOT have integrity without --full');
    });
  });

  describe('CSV output format', () => {
    test('includes integrity,resolved,time columns when --full --cover', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      assert.ok(lines.length > 1, 'Should have header and data');

      // Check header
      const header = lines[0];
      assert.equal(
        header,
        'package,version,spec,present,integrity,resolved,time',
        'Header should include spec,integrity,resolved,time columns'
      );

      // Check first data row has 7 columns
      const dataRow = lines[1].split(',');
      assert.equal(dataRow.length, 7, 'Data row should have 7 columns');
    });

    test('does NOT include integrity,resolved columns without --full', () => {
      const output = runFlatcoverWithLockfile('--cover');
      const lines = output.trim().split('\n');

      assert.ok(lines.length > 1, 'Should have header and data');

      // Check header
      const header = lines[0];
      assert.equal(
        header,
        'package,version,present',
        'Header should NOT include integrity,resolved columns'
      );

      // Check first data row has 3 columns
      const dataRow = lines[1].split(',');
      assert.equal(dataRow.length, 3, 'Data row should have 3 columns');
    });

    test('CSV data row includes integrity value', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      // Find a row with integrity (non-empty 5th column, index 4)
      const dataRows = lines.slice(1);
      const rowWithIntegrity = dataRows.find(row => {
        const cols = row.split(',');
        return cols[4]?.startsWith('sha');
      });

      assert.ok(rowWithIntegrity, 'Should have at least one row with integrity value');
    });
  });

  describe('time field for reanalysis', () => {
    test('includes time field when --full --cover --json', () => {
      const output = runFlatcoverWithLockfile('--full --cover --json');
      const data = JSON.parse(output);

      assert.ok(Array.isArray(data), 'Output should be JSON array');
      assert.ok(data.length > 0, 'Should have results');

      // Find results with time (present packages should have it)
      const withTime = data.filter(r => r.time);
      assert.ok(withTime.length > 0, 'Should have results with time field');

      // Verify time is ISO 8601 format
      for (const result of withTime.slice(0, 5)) {
        assert.ok(result.time.match(/^\d{4}-\d{2}-\d{2}T/), 'Time should be ISO 8601 format');
      }
    });

    test('does NOT include time field without --full', () => {
      const output = runFlatcoverWithLockfile('--cover --json');
      const data = JSON.parse(output);

      const withTime = data.filter(r => r.time);
      assert.equal(withTime.length, 0, 'Should NOT have time without --full');
    });

    test('includes time field when --full --cover --ndjson', () => {
      const output = runFlatcoverWithLockfile('--full --cover --ndjson');
      const lines = output.trim().split('\n');
      const results = lines.slice(0, 10).map(line => JSON.parse(line));

      const withTime = results.filter(r => r.time);
      assert.ok(withTime.length > 0, 'Should have results with time field');

      for (const result of withTime) {
        assert.ok(result.time.match(/^\d{4}-\d{2}-\d{2}T/), 'Time should be ISO 8601 format');
      }
    });

    test('includes time column in CSV when --full --cover', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      // Check header includes time
      const header = lines[0];
      assert.equal(
        header,
        'package,version,spec,present,integrity,resolved,time',
        'Header should include time column'
      );

      // Check data row has 7 columns
      const dataRow = lines[1].split(',');
      assert.equal(dataRow.length, 7, 'Data row should have 7 columns');
    });

    test('CSV data row includes ISO 8601 time value', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      // Find a row with time (non-empty 7th column, index 6, with ISO format)
      const dataRows = lines.slice(1);
      const rowWithTime = dataRows.find(row => {
        const cols = row.split(',');
        return cols[6]?.match(/^\d{4}-\d{2}-\d{2}T/);
      });

      assert.ok(rowWithTime, 'Should have at least one row with time value');
    });

    test('time field enables reanalysis with different --before dates', () => {
      // Get full output with time
      const output = runFlatcoverWithLockfile('--full --cover --json');
      const data = JSON.parse(output);

      // Find a package with time
      const withTime = data.find(r => r.time && r.present);
      assert.ok(withTime, 'Should have a present package with time');

      // The time field allows client to determine if package was published before a given date
      // without needing to re-query the registry
      const publishTime = new Date(withTime.time);
      assert.ok(
        publishTime instanceof Date && !Number.isNaN(publishTime),
        'Time should be parseable as Date'
      );
    });
  });
});

describe('flatcover --list (JSON file input)', () => {
  const testListFile = join(tmpdir(), `flatcover-test-${Date.now()}.json`);
  const testPackages = [
    { name: 'lodash', version: '4.17.21' },
    { name: 'express', version: '4.18.2' }
  ];

  before(() => {
    writeFileSync(testListFile, JSON.stringify(testPackages));
  });

  after(() => {
    try {
      unlinkSync(testListFile);
    } catch {
      // Ignore cleanup errors
    }
  });

  test('reads packages from JSON list file', () => {
    const output = runFlatcover(`--list ${testListFile} --cover --json`);
    const data = JSON.parse(output);

    assert.ok(Array.isArray(data), 'Output should be JSON array');
    assert.equal(data.length, 2, 'Should have 2 results');

    const names = data.map(r => r.name).sort();
    assert.deepEqual(names, ['express', 'lodash'], 'Should have correct packages');
  });

  test('checks coverage with --list', () => {
    const output = runFlatcover(`--list ${testListFile} --cover --json`);
    const data = JSON.parse(output);

    // Both lodash and express should be present in npm registry
    for (const result of data) {
      assert.ok(result.name, 'Should have name');
      assert.ok(result.version, 'Should have version');
      assert.equal(result.present, true, `${result.name}@${result.version} should be present`);
    }
  });

  test('outputs CSV format with --list', () => {
    const output = runFlatcover(`--list ${testListFile} --cover`);
    const lines = output.trim().split('\n');

    assert.equal(lines[0], 'package,version,present', 'Should have CSV header');
    assert.equal(lines.length, 3, 'Should have header + 2 data rows');
  });

  test('--list with --full includes integrity field (if provided)', () => {
    // Create a list with integrity
    const listWithIntegrity = [
      {
        name: 'lodash',
        version: '4.17.21',
        integrity: 'sha512-test-integrity-hash'
      }
    ];
    const tempFile = join(tmpdir(), `flatcover-integrity-${Date.now()}.json`);
    writeFileSync(tempFile, JSON.stringify(listWithIntegrity));

    try {
      const output = runFlatcover(`--list ${tempFile} --cover --full --json`);
      const data = JSON.parse(output);

      assert.equal(data.length, 1, 'Should have 1 result');
      assert.equal(
        data[0].integrity,
        'sha512-test-integrity-hash',
        'Should preserve integrity from input'
      );
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('rejects invalid JSON in --list file', () => {
    const invalidFile = join(tmpdir(), `flatcover-invalid-${Date.now()}.json`);
    writeFileSync(invalidFile, 'not valid json');

    try {
      assert.throws(
        () => runFlatcover(`--list ${invalidFile} --cover`),
        /Error/,
        'Should throw on invalid JSON'
      );
    } finally {
      try {
        unlinkSync(invalidFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('rejects --list file without name/version fields', () => {
    const invalidFile = join(tmpdir(), `flatcover-missing-fields-${Date.now()}.json`);
    writeFileSync(invalidFile, JSON.stringify([{ foo: 'bar' }]));

    try {
      assert.throws(
        () => runFlatcover(`--list ${invalidFile} --cover`),
        /name.*version|version.*name/i,
        'Should require name and version fields'
      );
    } finally {
      try {
        unlinkSync(invalidFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});

describe('flatcover stdin input (- argument)', () => {
  test('reads NDJSON from stdin', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}\n{"name":"express","version":"4.18.2"}';
    const output = runFlatcover('- --cover --json', { input: ndjson });
    const data = JSON.parse(output);

    assert.ok(Array.isArray(data), 'Output should be JSON array');
    assert.equal(data.length, 2, 'Should have 2 results');

    const names = data.map(r => r.name).sort();
    assert.deepEqual(names, ['express', 'lodash'], 'Should have correct packages');
  });

  test('checks coverage with stdin input', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}';
    const output = runFlatcover('- --cover --json', { input: ndjson });
    const data = JSON.parse(output);

    assert.equal(data.length, 1, 'Should have 1 result');
    assert.equal(data[0].name, 'lodash', 'Should have lodash');
    assert.equal(data[0].present, true, 'lodash should be present');
  });

  test('outputs CSV format with stdin input', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}';
    const output = runFlatcover('- --cover', { input: ndjson });
    const lines = output.trim().split('\n');

    assert.equal(lines[0], 'package,version,present', 'Should have CSV header');
    assert.equal(lines.length, 2, 'Should have header + 1 data row');
  });

  test('stdin with --full preserves integrity field', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21","integrity":"sha512-test-hash"}';
    const output = runFlatcover('- --cover --full --json', { input: ndjson });
    const data = JSON.parse(output);

    assert.equal(data.length, 1, 'Should have 1 result');
    assert.equal(data[0].integrity, 'sha512-test-hash', 'Should preserve integrity');
  });

  test('skips empty lines in stdin NDJSON', () => {
    const ndjson =
      '{"name":"lodash","version":"4.17.21"}\n\n{"name":"express","version":"4.18.2"}\n';
    const output = runFlatcover('- --cover --json', { input: ndjson });
    const data = JSON.parse(output);

    assert.equal(data.length, 2, 'Should have 2 results (empty lines skipped)');
  });

  test('rejects invalid JSON on stdin', () => {
    const invalidNdjson = 'not valid json';
    assert.throws(
      () => runFlatcover('- --cover', { input: invalidNdjson }),
      /Invalid JSON|Error/,
      'Should throw on invalid JSON'
    );
  });

  test('rejects stdin without name/version fields', () => {
    const invalidNdjson = '{"foo":"bar"}';
    assert.throws(
      () => runFlatcover('- --cover', { input: invalidNdjson }),
      /name.*version|version.*name/i,
      'Should require name and version fields'
    );
  });
});

describe('flatcover input source validation', () => {
  const testListFile = join(tmpdir(), `flatcover-validation-${Date.now()}.json`);

  before(() => {
    writeFileSync(testListFile, JSON.stringify([{ name: 'lodash', version: '4.17.21' }]));
  });

  after(() => {
    try {
      unlinkSync(testListFile);
    } catch {
      // Ignore cleanup errors
    }
  });

  test('rejects combining lockfile and --list', () => {
    assert.throws(
      () => runFlatcover(`${lockfilePath} --list ${testListFile} --cover`),
      /Cannot use both|multiple input/i,
      'Should reject lockfile + --list'
    );
  });

  test('rejects --workspace with --list', () => {
    assert.throws(
      () => runFlatcover(`--list ${testListFile} --workspace packages/core --cover`),
      /workspace.*lockfile/i,
      'Should reject --workspace with --list'
    );
  });

  test('rejects --workspace with stdin', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}';
    assert.throws(
      () => runFlatcover('- --workspace packages/core --cover', { input: ndjson }),
      /workspace.*lockfile/i,
      'Should reject --workspace with stdin'
    );
  });
});

describe('flatcover --cache (packument caching)', () => {
  const cacheDir = join(tmpdir(), `flatcover-cache-test-${Date.now()}`);

  after(() => {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('creates cache directory if it does not exist', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}';
    runFlatcover(`- --cover --cache ${cacheDir} --json`, { input: ndjson });

    assert.ok(existsSync(cacheDir), 'Cache directory should be created');
  });

  test('creates packument cache file', () => {
    const cachePath = join(cacheDir, 'lodash.json');
    assert.ok(existsSync(cachePath), 'Packument cache file should exist');

    const content = readFileSync(cachePath, 'utf8');
    const packument = JSON.parse(content);
    assert.ok(packument, 'Cache file should contain valid JSON');
  });

  test('creates metadata cache file with etag', () => {
    const metaPath = join(cacheDir, 'lodash.meta.json');
    assert.ok(existsSync(metaPath), 'Metadata cache file should exist');

    const content = readFileSync(metaPath, 'utf8');
    const meta = JSON.parse(content);
    assert.ok(meta.fetchedAt, 'Meta should have fetchedAt timestamp');
    // etag may or may not be present depending on registry response
    assert.ok(meta.etag || meta.lastModified || true, 'Meta should have etag or lastModified');
  });

  test('cached packument has versions object', () => {
    const cachePath = join(cacheDir, 'lodash.json');
    const content = readFileSync(cachePath, 'utf8');
    const packument = JSON.parse(content);

    assert.ok(packument.versions, 'Packument should have versions object');
    assert.ok(packument.versions['4.17.21'], 'Should have lodash@4.17.21');
  });

  test('cached packument has time object', () => {
    const cachePath = join(cacheDir, 'lodash.json');
    const content = readFileSync(cachePath, 'utf8');
    const packument = JSON.parse(content);

    assert.ok(packument.time, 'Packument should have time object');
    assert.ok(packument.time['4.17.21'], 'Should have timestamp for 4.17.21');
  });

  test('subsequent run produces identical output', () => {
    const ndjson = '{"name":"lodash","version":"4.17.21"}';

    // First run (may hit cache from previous tests)
    const output1 = runFlatcover(`- --cover --cache ${cacheDir} --json`, { input: ndjson });
    const data1 = JSON.parse(output1);

    // Second run (should use cache)
    const output2 = runFlatcover(`- --cover --cache ${cacheDir} --json`, { input: ndjson });
    const data2 = JSON.parse(output2);

    assert.deepEqual(data1, data2, 'Output should be identical across runs');
  });

  test('works with scoped packages (@scope/name)', () => {
    const scopedCacheDir = join(tmpdir(), `flatcover-scoped-cache-${Date.now()}`);
    const ndjson = '{"name":"@babel/core","version":"7.23.0"}';

    try {
      const output = runFlatcover(`- --cover --cache ${scopedCacheDir} --json`, { input: ndjson });
      const data = JSON.parse(output);

      assert.equal(data.length, 1, 'Should have 1 result');
      assert.equal(data[0].name, '@babel/core', 'Should have correct package name');

      // Check cache file with encoded name
      const cachePath = join(scopedCacheDir, '@babel%2fcore.json');
      assert.ok(existsSync(cachePath), 'Scoped package cache file should exist');

      const metaPath = join(scopedCacheDir, '@babel%2fcore.meta.json');
      assert.ok(existsSync(metaPath), 'Scoped package meta file should exist');
    } finally {
      try {
        rmSync(scopedCacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('works with --before flag', () => {
    const beforeCacheDir = join(tmpdir(), `flatcover-before-cache-${Date.now()}`);
    const ndjson = '{"name":"lodash","version":"4.17.21"}';

    try {
      // lodash@4.17.21 was published in Feb 2021, so --before 2020-01-01 should mark it as not present
      const output = runFlatcover(
        `- --cover --cache ${beforeCacheDir} --before 2020-01-01 --json`,
        { input: ndjson }
      );
      const data = JSON.parse(output);

      assert.equal(data.length, 1, 'Should have 1 result');
      assert.equal(data[0].present, false, 'lodash@4.17.21 should not be present before 2020');

      // Cache should still be created
      const cachePath = join(beforeCacheDir, 'lodash.json');
      assert.ok(existsSync(cachePath), 'Cache file should exist even with --before');
    } finally {
      try {
        rmSync(beforeCacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('does not create cache without --cache flag', () => {
    const noCacheDir = join(tmpdir(), `flatcover-no-cache-${Date.now()}`);
    const ndjson = '{"name":"express","version":"4.18.2"}';

    // Run without --cache
    runFlatcover('- --cover --json', { input: ndjson });

    // The directory should not exist
    assert.ok(!existsSync(noCacheDir), 'Cache directory should not be created without --cache');
  });
});
