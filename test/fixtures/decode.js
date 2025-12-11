#!/usr/bin/env node
/**
 * Decode all base64-encoded test fixtures to test/decoded/*
 * Preserves the same directory structure as test/fixtures
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = __dirname;
const decodedDir = join(dirname(__dirname), 'decoded');

/**
 * Recursively get all files in a directory
 * @param {string} dir - Directory to scan
 * @param {string[]} files - Accumulator for file paths
 * @returns {string[]} Array of file paths
 */
function getAllFiles(dir, files = [], skipDirs = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!skipDirs.includes(entry)) {
        getAllFiles(fullPath, files, skipDirs);
      }
    } else if (stat.isFile() && !entry.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Check if content is likely base64 encoded
 * @param {string} content - File content
 * @returns {boolean}
 */
function isBase64(content) {
  // Base64 encoded content should only contain these characters
  const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
  if (!base64Regex.test(content.trim())) {
    return false;
  }
  // Try to decode and see if it produces valid UTF-8
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf8');
    // Check if decoded content looks like valid text (JSON, YAML, etc.)
    return decoded.length > 0 && !decoded.includes('\ufffd');
  } catch {
    return false;
  }
}

/**
 * Decode a single fixture file
 * @param {string} srcPath - Source file path
 * @param {string} destPath - Destination file path
 */
function decodeFile(srcPath, destPath) {
  const content = readFileSync(srcPath, 'utf8');

  let decoded;
  if (isBase64(content)) {
    decoded = Buffer.from(content, 'base64').toString('utf8');
  } else {
    // File is not base64 encoded, copy as-is
    decoded = content;
  }

  // Ensure destination directory exists
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, decoded, 'utf8');
}

// Main execution
console.log('Decoding fixtures from test/fixtures to test/decoded...\n');

// Skip 'ext' directory - those files are not base64 encoded
const files = getAllFiles(fixturesDir, [], ['ext', 'tmp']);
let count = 0;

for (const srcPath of files) {
  const relativePath = relative(fixturesDir, srcPath);
  const destPath = join(decodedDir, relativePath);

  try {
    decodeFile(srcPath, destPath);
    console.log(`  Decoded: ${relativePath}`);
    count++;
  } catch (err) {
    console.error(`  Error decoding ${relativePath}: ${err.message}`);
  }
}

console.log(`\nDecoded ${count} fixture files to test/decoded/`);
