/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

import chokidar from 'chokidar';
import { glob } from 'glob';
import slash from 'slash';
import { transformWithEsbuild } from 'vite';

type ScriptGlobSync = (pattern: string) => string[];

export interface ScriptCoreDependencies {
  existsSync: typeof fs.existsSync;
  mkdirSync: typeof fs.mkdirSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  transformWithEsbuild: typeof transformWithEsbuild;
  globSync: ScriptGlobSync;
  createWatcher: typeof chokidar.watch;
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export const defaultScriptCoreDependencies: ScriptCoreDependencies = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  transformWithEsbuild,
  globSync: glob.sync,
  createWatcher: chokidar.watch,
  log: console.log.bind(console),
};

export const getScriptTransformOptions = (inputPath: string) => ({
  minify: true,
  format: 'esm' as const,
  sourcemap: path.basename(inputPath).includes('critical') ? false : ('external' as const),
});

/**
 * Resolves the output path for a compiled script file relative to the
 * consumer's project root.
 */
export const getScriptOutputPath = (inputPath: string, projectRoot: string): string => {
  return path.resolve(projectRoot, 'public/assets/js/' + path.parse(inputPath).name + '.js');
};

export const compileScript = async (
  inputPath: string,
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<void> => {
  dependencies.log('compile:', slash(inputPath));

  const code = dependencies.readFileSync(inputPath, 'utf8');

  return dependencies
    .transformWithEsbuild(code, inputPath, getScriptTransformOptions(inputPath))
    .then((result) => {
      const savePath = getScriptOutputPath(inputPath, projectRoot);
      const saveDir = path.dirname(savePath);

      if (!dependencies.existsSync(saveDir)) {
        dependencies.mkdirSync(saveDir);
      }

      dependencies.writeFileSync(savePath, result.code);
    })
    .catch((error) => {
      dependencies.log(error);
    });
};

export const watchScripts = (
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): ReturnType<typeof chokidar.watch> => {
  const watchPattern = slash(path.resolve(projectRoot, 'src/assets/scripts/**/*.{js,jsx,ts,tsx}'));
  const watcher = dependencies.createWatcher(watchPattern);

  watcher
    .on('add', (inputPath) => compileScript(inputPath, projectRoot, dependencies))
    .on('change', (inputPath) => compileScript(inputPath, projectRoot, dependencies))
    .on('unlink', (inputPath) => dependencies.log(`File ${inputPath} has been removed`));

  return watcher;
};

export const compileDiscoveredScripts = async (
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<void> => {
  const pool: Promise<unknown>[] = [];
  const globPattern = slash(path.resolve(projectRoot, 'src/assets/scripts/**/*.{js,jsx,ts,tsx}'));

  dependencies.globSync(globPattern).forEach((inputPath) => {
    pool.push(compileScript(inputPath, projectRoot, dependencies));
  });

  await Promise.all(pool);
};

export const runScriptBuild = async (
  projectRoot: string,
  argv = process.argv,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ReturnType<typeof chokidar.watch> | void> => {
  if (argv.includes('--watch')) {
    return watchScripts(projectRoot, dependencies);
  }

  return compileDiscoveredScripts(projectRoot, dependencies);
};
