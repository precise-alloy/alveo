import path from 'path';

import slash from 'slash';
import { loadEnv } from 'vite';

import { parseIntegrationArgs, runIntegrationBuild } from './integration-core.ts';

export interface IntegrationBuildOptions {
  projectRoot: string;
  argv?: string[];
}

/**
 * Runs the post-build integration pipeline for a consumer project.
 * Copies assets from `dist/static/assets/` to the integration directory
 * configured via `VITE_INTE_ASSET_DIR`.
 *
 * @param options.projectRoot - Absolute path to the consumer's project root
 * @param options.argv - Process arguments (defaults to process.argv)
 */
export const runIntegration = (options: IntegrationBuildOptions): { isValid: boolean; missing: string[] } => {
  const { projectRoot, argv = process.argv } = options;
  const { mode } = parseIntegrationArgs(argv);
  const alveoEnv = loadEnv(mode, projectRoot);
  const toAbsolute = (p: string) => slash(path.resolve(projectRoot, p));

  const staticBasePath = toAbsolute('dist/static');
  const srcBasePath = toAbsolute('dist/static/assets');
  const assetDir = alveoEnv.VITE_INTE_ASSET_DIR?.trim() ?? '';
  const patternDir = alveoEnv.VITE_INTE_PATTERN_DIR?.trim();
  const destBasePath = assetDir ? toAbsolute(assetDir) : '';
  const patternPath = patternDir ? toAbsolute(patternDir) : undefined;

  return runIntegrationBuild({
    projectRoot,
    staticBasePath,
    srcBasePath,
    destBasePath,
    patternPath,
    hashItems: ['css', 'images', 'js'],
    checkExistFileList: [
      { fileName: 'hashes.json' },
      { fileName: /react-loader\.0x[a-z0-9_-]{8,12}\.js/i, folder: 'js' },
      { fileName: 'main.js', folder: 'js' },
    ],
  });
};
