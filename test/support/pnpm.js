/**
 * pnpm-specific test utilities for monorepo testing
 */

import { x } from 'tinyexec';

export const packageManager = 'pnpm';
export const lockfileName = 'pnpm-lock.yaml';

/**
 * Run pnpm install in a directory
 * @param {string} dir - Project directory
 */
export async function install(dir) {
  const result = await x('pnpm', ['install'], {
    nodeOptions: { cwd: dir }
  });

  if (result.exitCode !== 0) {
    throw new Error(`pnpm install failed: ${result.stderr}`);
  }
}
