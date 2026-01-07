/**
 * npm-specific test utilities for monorepo testing
 */

import { x } from 'tinyexec';

export const packageManager = 'npm';
export const lockfileName = 'package-lock.json';

/**
 * Run npm install in a directory
 * @param {string} dir - Project directory
 */
export async function install(dir) {
  const result = await x('npm', ['install'], {
    nodeOptions: { cwd: dir }
  });

  if (result.exitCode !== 0) {
    throw new Error(`npm install failed: ${result.stderr}`);
  }
}
