/* eslint-disable no-console */

import { loadEnv } from 'vite';

import { startServer } from './create-server.js';

console.log('[INIT] server');

const argvModeIndex = process.argv.indexOf('--mode');
const mode =
  argvModeIndex >= 0 && argvModeIndex < process.argv.length - 1 && !process.argv[argvModeIndex + 1]!.startsWith('-')
    ? process.argv[argvModeIndex + 1]!
    : 'production';

/**
 * Starts the alveo Express server for the consumer's project.
 *
 * @param projectRoot - Absolute path to the consumer project's root directory.
 *                      When invoked via the CLI, this is resolved from the consumer's cwd.
 */
export function initServer(projectRoot: string) {
  const alveoEnv = loadEnv(mode, projectRoot);
  const isTest = !!alveoEnv.VITE_TEST_BUILD || process.env.NODE_ENV === 'test';
  const port = alveoEnv.VITE_PORT ? parseInt(alveoEnv.VITE_PORT!) : 5000;

  if (!isTest) {
    console.log(projectRoot);
    startServer({
      root: projectRoot,
      isTest,
      port,
      hmrPort: port + 1,
      baseUrl: alveoEnv.VITE_BASE_URL,
    });
  }
}
