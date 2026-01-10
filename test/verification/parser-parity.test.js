/**
 * Parser Parity Tests
 *
 * Verifies that flatlock and CycloneDX produce identical results
 * when parsing the same package-lock.json file.
 *
 * Test methodology:
 * 1. npm install a package to get a fresh lockfile
 * 2. Run CycloneDX with --package-lock-only
 * 3. Run flatlock on the same lockfile
 * 4. Compare results - they should be identical
 *
 * Any difference is a parser bug in either flatlock or CycloneDX.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { getParityResults } from '../support/parity.js';

// Test packages organized by complexity
const TEST_PACKAGES = {
  // Tier 1: Simple packages (0-10 deps) - fast tests
  simple: [
    { name: 'debug', version: '4.3.4' },
    { name: 'semver', version: '7.5.4' },
    { name: 'ms', version: '2.1.3' }
  ],

  // Tier 2: Medium packages (10-50 deps)
  medium: [
    { name: 'express', version: '4.18.2' },
    { name: 'commander', version: '12.0.0' }
  ],

  // Tier 3: Large packages (50-200 deps)
  large: [
    { name: 'eslint', version: '8.57.0' },
    { name: '@babel/core', version: '7.24.0' }
  ],

  // Tier 4: Very large packages (200+ deps)
  veryLarge: [{ name: 'jest', version: '29.7.0' }],

  // Edge cases
  edgeCases: [{ name: '@types/node', version: '20.11.0', note: 'scoped package' }]
};

/**
 * Run parity test for a single package
 */
async function assertParity(packageName, version) {
  const result = await getParityResults(packageName, version);

  // Log results
  console.log(`    CycloneDX (lockfile): ${result.counts.cyclonedxLockfile} packages`);
  console.log(`    CycloneDX (installed): ${result.counts.cyclonedxNodeModules} packages`);
  console.log(`    Flatlock:             ${result.counts.flatlock} packages`);

  // Check lockfile parity (should be exact match)
  const { lockfileParity } = result;
  if (!lockfileParity.equal) {
    console.log(`    LOCKFILE PARITY FAILED:`);
    if (lockfileParity.cyclonedx.packages.length > 0) {
      console.log(
        `      Only in CycloneDX: ${lockfileParity.cyclonedx.packages.slice(0, 5).join(', ')}`
      );
    }
    if (lockfileParity.flatlock.packages.length > 0) {
      console.log(
        `      Only in Flatlock: ${lockfileParity.flatlock.packages.slice(0, 5).join(', ')}`
      );
    }
  } else {
    console.log(`    Lockfile parity: PASS`);
  }

  // Check install parity (may differ for platform-specific packages)
  const { installParity } = result;
  if (!installParity.equal) {
    console.log(`    INSTALL PARITY (unexpected differences):`);
    if (installParity.cyclonedx.packages.length > 0) {
      console.log(
        `      Only in CycloneDX: ${installParity.cyclonedx.packages.slice(0, 5).join(', ')}`
      );
    }
    if (installParity.flatlock.packages.length > 0) {
      console.log(
        `      Only in Flatlock: ${installParity.flatlock.packages.slice(0, 5).join(', ')}`
      );
    }
  } else {
    console.log(`    Install parity: PASS (after filtering platform-specific)`);
  }

  // Assert lockfile parity - this is the strict test
  assert.strictEqual(
    lockfileParity.equal,
    true,
    `Lockfile parity failed: CycloneDX has ${lockfileParity.cyclonedx.unexpected} extra, ` +
      `Flatlock has ${lockfileParity.flatlock.unexpected} extra`
  );
}

// Run tests
describe('Parser Parity', { timeout: 600_000 }, () => {
  describe('Simple packages', () => {
    for (const { name, version } of TEST_PACKAGES.simple) {
      it(`${name}@${version}`, () => assertParity(name, version));
    }
  });

  describe('Medium packages', () => {
    for (const { name, version } of TEST_PACKAGES.medium) {
      it(`${name}@${version}`, () => assertParity(name, version));
    }
  });

  describe('Large packages', () => {
    for (const { name, version } of TEST_PACKAGES.large) {
      it(`${name}@${version}`, () => assertParity(name, version));
    }
  });

  describe('Very large packages', () => {
    for (const { name, version } of TEST_PACKAGES.veryLarge) {
      it(`${name}@${version}`, () => assertParity(name, version));
    }
  });

  describe('Edge cases', () => {
    for (const { name, version, note } of TEST_PACKAGES.edgeCases) {
      it(`${name}@${version} (${note || 'edge case'})`, () => assertParity(name, version));
    }
  });
});
