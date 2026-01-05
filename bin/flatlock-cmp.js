#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as flatlock from '../src/index.js';


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
 * Process a single lockfile using flatlock.compare()
 */
async function processFile(filepath, baseDir) {
  try {
    const result = await flatlock.compare(filepath);
    const rel = baseDir ? filepath.replace(baseDir + '/', '') : filepath;

    if (result.equinumerous === null) {
      // Unsupported type or no comparison available
      return {
        type: result.type,
        path: rel,
        source: result.source || 'unknown',
        flatlockCount: result.flatlockCount,
        comparisonCount: null,
        workspaceCount: 0,
        equinumerous: null,
        onlyInFlatlock: null,
        onlyInComparison: null
      };
    }

    return {
      type: result.type,
      path: rel,
      source: result.source,
      flatlockCount: result.flatlockCount,
      comparisonCount: result.comparisonCount,
      workspaceCount: result.workspaceCount,
      equinumerous: result.equinumerous,
      onlyInFlatlock: result.onlyInFlatlock,
      onlyInComparison: result.onlyInComparison
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
    console.log(`flatlock-cmp - Compare flatlock against established parsers

Usage:
  flatlock-cmp [files...]
  flatlock-cmp --dir <dir> [--glob <pattern>]

Options:
  -d, --dir <path>     Directory to scan
  -g, --glob <pattern> Glob pattern for filtering
  -q, --quiet          Only show mismatches and summary
  -h, --help           Show this help

Comparison parsers (workspace/link entries excluded from all):
  npm:          @npmcli/arborist (preferred) or @cyclonedx/cyclonedx-npm
  yarn-classic: @yarnpkg/lockfile
  yarn-berry:   @yarnpkg/parsers
  pnpm:         @pnpm/lockfile.fs (preferred) or js-yaml

Result types:
  ✓ equinumerous  Same packages in both (exact match)
  ⊃ SUPERSET      flatlock found MORE packages (expected for pnpm)
  ❌ MISMATCH      Unexpected difference (comparison found packages flatlock missed)

Note on pnpm supersets:
  flatlock performs full reachability analysis on lockfiles, finding all
  transitive dependencies. pnpm's official tools don't enumerate all reachable
  packages - they omit some transitive deps from their API output. When flatlock
  finds MORE packages than pnpm, this is expected and correct behavior.

Examples:
  flatlock-cmp package-lock.json
  flatlock-cmp --dir path/to/your/locker-room --glob "**/*package-lock*"
  flatlock-cmp --dir path/to/your/locker-room --glob "**/*yarn.lock*"
  flatlock-cmp --dir path/to/your/locker-room --glob "**/*pnpm-lock*"`);
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
  let supersetCount = 0;  // flatlock found more (expected for pnpm reachability)
  let mismatchCount = 0;

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
        console.log(`   ${result.source}: unavailable`);
      }
      continue;
    }

    totalComparison += result.comparisonCount;

    if (result.equinumerous) {
      matchCount++;
      if (!values.quiet) {
        const wsNote = result.workspaceCount > 0 ? ` (${result.workspaceCount} workspaces excluded)` : '';
        console.log(`✓  ${result.path}${wsNote}`);
        console.log(`   count: flatlock=${result.flatlockCount} ${result.source}=${result.comparisonCount}`);
        console.log(`   sets:  equinumerous`);
      }
    } else {
      // Determine if this is a "superset" (flatlock found more, expected for pnpm)
      // or a true "mismatch" (comparison found packages flatlock missed)
      const isPnpm = result.type === 'pnpm' || result.path.includes('pnpm-lock');
      const isSuperset = result.onlyInFlatlock.length > 0 && result.onlyInComparison.length === 0;

      if (isPnpm && isSuperset) {
        // Expected behavior: flatlock's reachability analysis found more packages
        supersetCount++;
        if (!values.quiet) {
          const wsNote = result.workspaceCount > 0 ? ` (${result.workspaceCount} workspaces excluded)` : '';
          console.log(`⊃  ${result.path}${wsNote}`);
          console.log(`   count: flatlock=${result.flatlockCount} ${result.source}=${result.comparisonCount}`);
          console.log(`   sets:  SUPERSET (+${result.onlyInFlatlock.length} reachable deps)`);
          console.log(`   note:  flatlock's reachability analysis found transitive deps pnpm omits`);
        }
      } else {
        mismatchCount++;
        console.log(`\n❌ ${result.path}`);
        console.log(`   count: flatlock=${result.flatlockCount} ${result.source}=${result.comparisonCount}`);
        console.log(`   sets:  MISMATCH`);

        if (result.onlyInFlatlock.length > 0) {
          console.log(`   only in flatlock (${result.onlyInFlatlock.length}):`);
          for (const pkg of result.onlyInFlatlock.slice(0, 10)) {
            console.log(`     + ${pkg}`);
          }
          if (result.onlyInFlatlock.length > 10) {
            console.log(`     ... and ${result.onlyInFlatlock.length - 10} more`);
          }
        }

        if (result.onlyInComparison.length > 0) {
          console.log(`   only in ${result.source} (${result.onlyInComparison.length}):`);
          for (const pkg of result.onlyInComparison.slice(0, 10)) {
            console.log(`     - ${pkg}`);
          }
          if (result.onlyInComparison.length > 10) {
            console.log(`     ... and ${result.onlyInComparison.length - 10} more`);
          }
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  const summaryParts = [`${fileCount} files`, `${matchCount} equinumerous`];
  if (supersetCount > 0) {
    summaryParts.push(`${supersetCount} supersets`);
  }
  summaryParts.push(`${mismatchCount} mismatches`, `${errorCount} errors`);
  console.log(`SUMMARY: ${summaryParts.join(', ')}`);

  console.log(`  flatlock total:    ${totalFlatlock.toString().padStart(8)} packages`);
  if (totalComparison > 0) {
    console.log(`  comparison total:  ${totalComparison.toString().padStart(8)} packages`);
  }
  if (totalWorkspaces > 0) {
    console.log(`  workspaces:        ${totalWorkspaces.toString().padStart(8)} excluded (local/workspace refs)`);
  }
  if (supersetCount > 0) {
    console.log(`  supersets:         ${supersetCount.toString().padStart(8)} (flatlock found more via reachability)`);
  }

  // Exit with error only for true mismatches (not supersets)
  // Supersets are expected: flatlock's reachability analysis is more thorough
  if (mismatchCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
