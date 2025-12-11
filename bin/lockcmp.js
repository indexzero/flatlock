#!/usr/bin/env node

import { readFile, readdir, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as flatlock from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Unique run ID for this script execution (7 char hash of timestamp)
const RUN_ID = Date.now().toString(36).slice(-7);
const TMP_BASE = join(__dirname, 'tmp', RUN_ID);
let tmpDirCreated = false;

// Comparison parsers (lazy loaded)
let Arborist, yarnLockfile, parseSyml, yaml;

async function loadArborist() {
  if (!Arborist) {
    const mod = await import('@npmcli/arborist');
    Arborist = mod.default;
  }
  return Arborist;
}

async function loadYarnClassic() {
  if (!yarnLockfile) {
    const mod = await import('@yarnpkg/lockfile');
    yarnLockfile = mod.default || mod;
  }
  return yarnLockfile;
}

async function loadYarnBerry() {
  if (!parseSyml) {
    const mod = await import('@yarnpkg/parsers');
    parseSyml = mod.parseSyml;
  }
  return parseSyml;
}

async function loadYaml() {
  if (!yaml) {
    const mod = await import('js-yaml');
    yaml = mod.default;
  }
  return yaml;
}

/**
 * Ensure the temp directory for this run exists
 */
async function ensureTmpDir() {
  if (!tmpDirCreated) {
    await mkdir(TMP_BASE, { recursive: true });
    tmpDirCreated = true;
  }
}

/**
 * Cleanup the temp directory for this run
 */
async function cleanup() {
  if (tmpDirCreated) {
    try {
      await rm(TMP_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get packages set using @npmcli/arborist
 *
 * Arborist requires a directory with package-lock.json (and optionally package.json).
 * We create a temp directory structure for each lockfile:
 *   bin/tmp/<run-id>/<file-hash>/package-lock.json
 */
async function getPackagesFromNpm(content, filepath) {
  const ArboristClass = await loadArborist();
  await ensureTmpDir();

  // Create unique subdir for this lockfile
  const fileId = crypto.createHash('md5').update(filepath).digest('hex').slice(0, 7);
  const tmpDir = join(TMP_BASE, fileId);

  await mkdir(tmpDir, { recursive: true });
  await writeFile(join(tmpDir, 'package-lock.json'), content);

  // Create minimal package.json from lockfile root entry
  const lockfile = JSON.parse(content);
  const root = lockfile.packages?.[''] || {};
  const pkg = {
    name: root.name || 'arborist-temp',
    version: root.version || '1.0.0'
  };
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify(pkg));

  try {
    const arb = new ArboristClass({ path: tmpDir });
    const tree = await arb.loadVirtual();

    const result = new Set();
    let workspaceCount = 0;
    for (const node of tree.inventory.values()) {
      if (node.isRoot) continue;
      // Skip workspace symlinks (link:true, no version in raw lockfile)
      if (node.isLink) {
        workspaceCount++;
        continue;
      }
      // Skip workspace package definitions (not in node_modules)
      // Flatlock only yields packages from node_modules/ paths
      if (node.location && !node.location.includes('node_modules')) {
        workspaceCount++;
        continue;
      }
      if (node.name && node.version) {
        result.add(`${node.name}@${node.version}`);
      }
    }
    return { packages: result, workspaceCount };
  } finally {
    // Cleanup this specific lockfile's temp dir
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Get packages set using @yarnpkg/lockfile (classic)
 */
async function getPackagesFromYarnClassic(content) {
  const yarnLock = await loadYarnClassic();
  const parse = yarnLock.parse || yarnLock.default?.parse;
  const { object: lockfile } = parse(content);

  const result = new Set();
  for (const [key, pkg] of Object.entries(lockfile)) {
    if (key === '__metadata') continue;
    let name;
    if (key.startsWith('@')) {
      const idx = key.indexOf('@', 1);
      name = key.slice(0, idx);
    } else {
      name = key.split('@')[0];
    }
    if (name && pkg.version) result.add(`${name}@${pkg.version}`);
  }

  return { packages: result, workspaceCount: 0 };
}

/**
 * Get packages set using @yarnpkg/parsers (berry)
 */
async function getPackagesFromYarnBerry(content) {
  const parse = await loadYarnBerry();
  const lockfile = parse(content);

  const result = new Set();
  for (const [key, pkg] of Object.entries(lockfile)) {
    if (key === '__metadata') continue;
    let name;
    if (key.startsWith('@')) {
      const idx = key.indexOf('@', 1);
      name = key.slice(0, idx);
    } else {
      name = key.split('@')[0];
    }
    if (name && pkg.version) result.add(`${name}@${pkg.version}`);
  }

  return { packages: result, workspaceCount: 0 };
}

/**
 * Get packages set using js-yaml (pnpm)
 */
async function getPackagesFromPnpm(content) {
  const y = await loadYaml();
  const lockfile = y.load(content);
  const packages = lockfile.packages || {};

  const result = new Set();
  for (const [key, pkg] of Object.entries(packages)) {
    // pnpm keys are like /lodash@4.17.21 or /@babel/core@7.0.0
    const match = key.match(/^\/?(@?[^@]+)@(.+)$/);
    if (match) result.add(`${match[1]}@${match[2]}`);
  }

  return { packages: result, workspaceCount: 0 };
}

/**
 * Get packages set with flatlock
 */
async function getPackagesFromFlatlock(filepath) {
  const result = new Set();
  for await (const dep of flatlock.fromPath(filepath)) {
    if (dep.name && dep.version) result.add(`${dep.name}@${dep.version}`);
  }
  return result;
}

/**
 * Get comparison parser name for type
 */
function getComparisonName(type) {
  switch (type) {
    case 'npm': return '@npmcli/arborist';
    case 'yarn-classic': return '@yarnpkg/lockfile';
    case 'yarn-berry': return '@yarnpkg/parsers';
    case 'pnpm': return 'js-yaml';
    default: return 'unknown';
  }
}

/**
 * Get packages with comparison parser based on type
 */
async function getPackagesFromComparison(type, content, filepath) {
  switch (type) {
    case 'npm': return getPackagesFromNpm(content, filepath);
    case 'yarn-classic': return getPackagesFromYarnClassic(content);
    case 'yarn-berry': return getPackagesFromYarnBerry(content);
    case 'pnpm': return getPackagesFromPnpm(content);
    default: return null;
  }
}

/**
 * Compare two sets and return differences
 */
function compareSets(setA, setB) {
  const onlyInA = new Set([...setA].filter(x => !setB.has(x)));
  const onlyInB = new Set([...setB].filter(x => !setA.has(x)));
  return { onlyInA, onlyInB };
}

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern) {
  let regex = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  regex = regex.replace(/\*\*/g, '__DOUBLESTAR__');
  regex = regex.replace(/\*/g, '[^/]*');
  regex = regex.replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp(`^${regex}$`);
}

/**
 * Find files in directory matching glob pattern
 */
async function findFiles(dir, pattern) {
  const entries = await readdir(dir, { recursive: true, encoding: 'utf8' });
  const regex = pattern ? globToRegex(pattern) : null;

  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (regex && !regex.test(entry)) continue;

    try {
      const stats = await stat(fullPath);
      if (stats.isFile()) files.push(fullPath);
    } catch {
      continue;
    }
  }

  return files.sort();
}

/**
 * Process a single lockfile - compare sets, not just counts
 */
async function processFile(filepath, baseDir) {
  try {
    const content = await readFile(filepath, 'utf8');
    const type = flatlock.detectType({ path: filepath, content });
    const rel = baseDir ? filepath.replace(baseDir + '/', '') : filepath;
    const comparisonName = getComparisonName(type);

    const flatlockSet = await getPackagesFromFlatlock(filepath);
    let comparisonResult;

    try {
      comparisonResult = await getPackagesFromComparison(type, content, filepath);
    } catch (err) {
      comparisonResult = null;
    }

    if (!comparisonResult) {
      return {
        type,
        path: rel,
        comparisonName,
        flatlockCount: flatlockSet.size,
        comparisonCount: null,
        workspaceCount: 0,
        identical: null,
        onlyInFlatlock: null,
        onlyInComparison: null
      };
    }

    const { packages: comparisonSet, workspaceCount } = comparisonResult;
    const { onlyInA: onlyInFlatlock, onlyInB: onlyInComparison } = compareSets(flatlockSet, comparisonSet);
    const identical = onlyInFlatlock.size === 0 && onlyInComparison.size === 0;

    return {
      type,
      path: rel,
      comparisonName,
      flatlockCount: flatlockSet.size,
      comparisonCount: comparisonSet.size,
      workspaceCount,
      identical,
      onlyInFlatlock,
      onlyInComparison
    };
  } catch (err) {
    const rel = baseDir ? filepath.replace(baseDir + '/', '') : filepath;
    return { error: err.message, path: rel };
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      dir: { type: 'string', short: 'd' },
      glob: { type: 'string', short: 'g' },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`lockcmp - Compare flatlock against established parsers

Usage:
  lockcmp [files...]
  lockcmp --dir <dir> [--glob <pattern>]

Options:
  -d, --dir <path>     Directory to scan
  -g, --glob <pattern> Glob pattern for filtering
  -q, --quiet          Only show mismatches and summary
  -h, --help           Show this help

Comparison parsers:
  npm:          @npmcli/arborist (loadVirtual)
  yarn-classic: @yarnpkg/lockfile
  yarn-berry:   @yarnpkg/parsers
  pnpm:         js-yaml

Examples:
  lockcmp package-lock.json
  lockcmp --dir test/fixtures/ext --glob "**/*package-lock*"
  lockcmp --dir test/fixtures/ext --glob "**/*yarn.lock*"
  lockcmp --dir test/fixtures/ext --glob "**/*pnpm-lock.yaml*"`);
    process.exit(0);
  }

  let files = [];
  const baseDir = values.dir;

  if (baseDir) {
    files = await findFiles(baseDir, values.glob);
    if (!files.length) {
      console.error(`No files found in ${baseDir}${values.glob ? ` matching ${values.glob}` : ''}`);
      process.exit(1);
    }
  } else if (positionals.length > 0) {
    files = positionals;
  } else {
    console.error('No files specified. Use --help for usage.');
    process.exit(1);
  }

  let totalFlatlock = 0;
  let totalComparison = 0;
  let totalWorkspaces = 0;
  let fileCount = 0;
  let errorCount = 0;
  let matchCount = 0;
  let mismatchCount = 0;

  try {
    for (const file of files) {
      const result = await processFile(file, baseDir);

      if (result.error) {
        errorCount++;
        if (!values.quiet) {
          console.log(`\n❌ ERROR: ${result.path}`);
          console.log(`   ${result.error}`);
        }
        continue;
      }

      fileCount++;
      totalFlatlock += result.flatlockCount;
      totalWorkspaces += result.workspaceCount || 0;

      if (result.comparisonCount === null) {
        if (!values.quiet) {
          console.log(`\n⚠️  ${result.path}`);
          console.log(`   flatlock: ${result.flatlockCount} packages`);
          console.log(`   ${result.comparisonName}: unavailable`);
        }
        continue;
      }

      totalComparison += result.comparisonCount;

      if (result.identical) {
        matchCount++;
        if (!values.quiet) {
          const wsNote = result.workspaceCount > 0 ? ` (${result.workspaceCount} workspaces excluded)` : '';
          console.log(`✓  ${result.path}${wsNote}`);
          console.log(`   count: flatlock=${result.flatlockCount} ${result.comparisonName}=${result.comparisonCount}`);
          console.log(`   sets:  identical`);
        }
      } else {
        mismatchCount++;
        console.log(`\n❌ ${result.path}`);
        console.log(`   count: flatlock=${result.flatlockCount} ${result.comparisonName}=${result.comparisonCount}`);
        console.log(`   sets:  MISMATCH`);

        if (result.onlyInFlatlock.size > 0) {
          console.log(`   only in flatlock (${result.onlyInFlatlock.size}):`);
          for (const pkg of [...result.onlyInFlatlock].slice(0, 10)) {
            console.log(`     + ${pkg}`);
          }
          if (result.onlyInFlatlock.size > 10) {
            console.log(`     ... and ${result.onlyInFlatlock.size - 10} more`);
          }
        }

        if (result.onlyInComparison.size > 0) {
          console.log(`   only in ${result.comparisonName} (${result.onlyInComparison.size}):`);
          for (const pkg of [...result.onlyInComparison].slice(0, 10)) {
            console.log(`     - ${pkg}`);
          }
          if (result.onlyInComparison.size > 10) {
            console.log(`     ... and ${result.onlyInComparison.size - 10} more`);
          }
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log(`SUMMARY: ${fileCount} files, ${matchCount} identical, ${mismatchCount} mismatches, ${errorCount} errors`);
    console.log(`  flatlock total:    ${totalFlatlock.toString().padStart(8)} packages`);
    if (totalComparison > 0) {
      console.log(`  comparison total:  ${totalComparison.toString().padStart(8)} packages`);
    }
    if (totalWorkspaces > 0) {
      console.log(`  workspaces:        ${totalWorkspaces.toString().padStart(8)} excluded (npm workspace symlinks)`);
    }

    // Exit with error if any mismatches
    if (mismatchCount > 0) {
      process.exit(1);
    }
  } finally {
    await cleanup();
  }
}

main().catch(async err => {
  await cleanup();
  console.error('Fatal error:', err.message);
  process.exit(1);
});
