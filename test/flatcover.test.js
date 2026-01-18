/**
 * @fileoverview Tests for flatcover CLI --full --cover functionality
 *
 * These tests verify that the --full flag works correctly with --cover mode,
 * including integrity and resolved fields in the output across all formats.
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', 'bin', 'flatcover.js');
const lockfilePath = join(__dirname, '..', 'pnpm-lock.yaml');

/**
 * Run flatcover CLI with given args and return stdout
 * @param {string} args - CLI arguments
 * @returns {string} stdout output
 */
function runFlatcover(args) {
  return execSync(`node ${binPath} ${lockfilePath} ${args}`, {
    encoding: 'utf8',
    timeout: 30000
  });
}

describe('flatcover --full --cover', () => {
  describe('JSON output format', () => {
    test('includes integrity field when --full --cover --json', () => {
      const output = runFlatcover('--full --cover --json');
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
      const output = runFlatcover('--cover --json');
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
      const output = runFlatcover('--full --cover --ndjson');
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
      const output = runFlatcover('--cover --ndjson');
      const lines = output.trim().split('\n');
      const results = lines.slice(0, 10).map(line => JSON.parse(line));

      const withIntegrity = results.filter(r => r.integrity);
      assert.equal(withIntegrity.length, 0, 'Should NOT have integrity without --full');
    });
  });

  describe('CSV output format', () => {
    test('includes integrity,resolved columns when --full --cover', () => {
      const output = runFlatcover('--full --cover');
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
      const output = runFlatcover('--cover');
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
      const output = runFlatcover('--full --cover');
      const lines = output.trim().split('\n');

      // Find a row with integrity (non-empty 4th column)
      const dataRows = lines.slice(1);
      const rowWithIntegrity = dataRows.find(row => {
        const cols = row.split(',');
        return cols[3] && cols[3].startsWith('sha');
      });

      assert.ok(rowWithIntegrity, 'Should have at least one row with integrity value');
    });
  });
});
