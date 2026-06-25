import fs from 'fs';
import path from 'path';
import nodeFs from 'node:fs';

import slash from 'slash';
import { glob } from 'glob';
import { loadEnv } from 'vite';
import chalk from 'chalk';

import { CopyItem, FileExistCheck, parseIntegrationArgs, runIntegrationBuild } from './integration-core.js';

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
  const log = console.log.bind(console);

  const staticBasePath = toAbsolute('dist/static');
  const srcBasePath = toAbsolute('dist/static/assets');
  const destBasePath = toAbsolute(alveoEnv.VITE_INTE_ASSET_DIR ?? '');
  const patternPath = alveoEnv.VITE_INTE_PATTERN_DIR ? toAbsolute(alveoEnv.VITE_INTE_PATTERN_DIR) : undefined;

  const copyItems: CopyItem[] = [
    { from: 'css' },
    { from: 'fonts' },
    { from: 'images' },
    { from: 'js' },
    { from: 'vendors' },
    { from: 'hashes.json' },
    { from: 'pages', to: patternPath },
  ];
  const hashItems: string[] = ['css', 'images', 'js'];

  const checkExistFileList: FileExistCheck[] = [
    { fileName: 'hashes.json' },
    { fileName: /react-loader\.0x[a-z0-9_-]{8,12}\.js/gi, folder: 'js' },
    { fileName: 'main.js', folder: 'js' },
  ];

  const result = runIntegrationBuild(
    {
      argv,
      staticBasePath,
      srcBasePath,
      destBasePath,
      patternPath,
      copyItems,
      hashItems,
      checkExistFileList,
    },
    {
      existsSync: fs.existsSync,
      statSync: fs.statSync,
      rmSync: fs.rmSync,
      mkdirSync: fs.mkdirSync,
      cpSync: fs.cpSync,
      copyFileSync: fs.copyFileSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      readdirSync: fs.readdirSync,
      globSync: glob.sync,
      nodeFsCpSync: nodeFs.cpSync,
      log,
      warn: (value: string) => chalk.yellow(value),
    }
  );

  return result;
};
