/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

import chokidar from 'chokidar';
import debounce from 'debounce';
import { glob } from 'glob';
import slash from 'slash';

export interface StatesBuildOptions {
  projectRoot: string;
  isWatch?: boolean;
}

/**
 * Runs the state aggregation pipeline for a consumer project.
 * Watches consumer's `src/**\/*.states.json` and outputs aggregated
 * state to consumer's `public/pl-states.json`.
 *
 * @param options.projectRoot - Absolute path to the consumer's project root
 * @param options.isWatch - Whether to watch for changes (defaults to false)
 */
export const runStatesBuild = (options: StatesBuildOptions): void => {
  const { projectRoot, isWatch = false } = options;
  const log = console.log.bind(console);

  const states: { [filePath: string]: string } = {};
  const outputPath = path.resolve(projectRoot, 'public/pl-states.json');

  const buildStates = debounce(() => {
    const output: unknown[] = [];

    const keys = Object.keys(states);

    keys.forEach((key) => {
      const state = states[key];

      if (!state) {
        return;
      }

      try {
        output.push(JSON.parse(state));
      } catch (error) {
        console.log(error);
      }
    });

    const json = JSON.stringify(output, null, '  ');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, json);
  }, 500);

  const setStates = (statePath: string): void => {
    const absPath = path.isAbsolute(statePath) ? statePath : path.resolve(projectRoot, statePath);
    const state = fs.readFileSync(absPath, 'utf-8');

    states[statePath] = state;
    buildStates();
  };

  const removeStates = (statePath: string): void => {
    delete states[statePath];
    buildStates();
  };

  const globPattern = slash(path.resolve(projectRoot, 'src/**/*.states.json'));

  // Initial scan — works in both watch and non-watch mode
  glob.sync(globPattern).forEach((p) => setStates(p));

  if (isWatch) {
    const watcher = chokidar.watch(globPattern);

    watcher
      .on('ready', () => {
        log('States are ready!');
      })
      .on('add', (p) => setStates(p))
      .on('change', (p) => setStates(p))
      .on('unlink', (p) => removeStates(p));
  }
};
