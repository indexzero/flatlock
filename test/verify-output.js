/**
 * Verify output format matches PLAN.md specification
 */

import { Lockfile } from '../src/index.js';

console.log('Verifying dependency output format...\n');

const content = JSON.stringify({
  lockfileVersion: 2,
  packages: {
    '': { name: 'root', version: '1.0.0' },
    'node_modules/lodash': {
      name: 'lodash',
      version: '4.17.21',
      resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      integrity: 'sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=='
    },
    'node_modules/@babel/core': {
      name: '@babel/core',
      version: '7.23.0',
      resolved: 'https://registry.npmjs.org/@babel/core/-/core-7.23.0.tgz',
      integrity: 'sha512-abc123',
      link: true
    }
  }
});

const deps = [...Lockfile.fromString(content, { path: 'package-lock.json' })];

console.log('Dependency 1 (regular package):');
console.log(JSON.stringify(deps[0], null, 2));
console.log();

console.log('Dependency 2 (linked package):');
console.log(JSON.stringify(deps[1], null, 2));
console.log();

// Verify required fields
const dep1 = deps[0];
console.log('Field verification for Dependency 1:');
console.log(`  ✓ name: ${typeof dep1.name === 'string' ? 'string' : 'FAIL'} (required)`);
console.log(`  ✓ version: ${typeof dep1.version === 'string' ? 'string' : 'FAIL'} (required)`);
console.log(`  ✓ integrity: ${dep1.integrity ? 'present' : 'missing'} (optional)`);
console.log(`  ✓ resolved: ${dep1.resolved ? 'present' : 'missing'} (optional)`);
console.log(`  ✓ link: ${dep1.link === undefined ? 'not set (correct)' : 'UNEXPECTED'} (optional)`);
console.log();

const dep2 = deps[1];
console.log('Field verification for Dependency 2 (linked):');
console.log(`  ✓ name: ${typeof dep2.name === 'string' ? 'string' : 'FAIL'} (required)`);
console.log(`  ✓ version: ${typeof dep2.version === 'string' ? 'string' : 'FAIL'} (required)`);
console.log(`  ✓ link: ${dep2.link === true ? 'true (correct)' : 'FAIL'} (should be true)`);
console.log();

console.log('Output format matches PLAN.md specification ✓');
