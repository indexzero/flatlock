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
import { writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
    test('includes integrity,resolved columns when --full --cover', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      assert.ok(lines.length > 1, 'Should have header and data');

      // Check header
      const header = lines[0];
      assert.equal(header, 'package,version,present,integrity,resolved', 'Header should include integrity,resolved columns');

      // Check first data row has 5 columns
      const dataRow = lines[1].split(',');
      assert.equal(dataRow.length, 5, 'Data row should have 5 columns');
    });

    test('does NOT include integrity,resolved columns without --full', () => {
      const output = runFlatcoverWithLockfile('--cover');
      const lines = output.trim().split('\n');

      assert.ok(lines.length > 1, 'Should have header and data');

      // Check header
      const header = lines[0];
      assert.equal(header, 'package,version,present', 'Header should NOT include integrity,resolved columns');

      // Check first data row has 3 columns
      const dataRow = lines[1].split(',');
      assert.equal(dataRow.length, 3, 'Data row should have 3 columns');
    });

    test('CSV data row includes integrity value', () => {
      const output = runFlatcoverWithLockfile('--full --cover');
      const lines = output.trim().split('\n');

      // Find a row with integrity (non-empty 4th column)
      const dataRows = lines.slice(1);
      const rowWithIntegrity = dataRows.find(row => {
        const cols = row.split(',');
        return cols[3]?.startsWith('sha');
      });

      assert.ok(rowWithIntegrity, 'Should have at least one row with integrity value');
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
      assert.equal(data[0].integrity, 'sha512-test-integrity-hash', 'Should preserve integrity from input');
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
    const ndjson = '{"name":"lodash","version":"4.17.21"}\n\n{"name":"express","version":"4.18.2"}\n';
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
