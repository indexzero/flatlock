/**
 * yarn-specific test utilities for monorepo testing
 */

import { x } from 'tinyexec';

export const packageManager = 'yarn';
export const lockfileName = 'yarn.lock';

/**
 * Run yarn install in a directory
 * @param {string} dir - Project directory
 */
export async function install(dir) {
  const result = await x('yarn', ['install'], {
    nodeOptions: { cwd: dir }
  });

  if (result.exitCode !== 0) {
    throw new Error(`yarn install failed: ${result.stderr}`);
  }
}
