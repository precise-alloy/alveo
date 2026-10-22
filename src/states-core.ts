import fs from 'fs';
import path from 'path';

import chokidar from 'chokidar';
import debounce from 'debounce';
import { glob } from 'glob';
import slash from 'slash';

type StateWatcher = ReturnType<typeof chokidar.watch>;
type StateDebounce = (callback: () => void, wait: number) => () => void;
type StateGlobSync = (pattern: string) => string[];

export interface StateParseError {
  filePath: string;
  error: unknown;
}

export interface StateAggregationResult {
  output: unknown[];
  errors: StateParseError[];
}

export interface StateBuildResult {
  ok: boolean;
  errors: StateParseError[];
}

export interface StatesCoreDependencies {
  existsSync: typeof fs.existsSync;
  mkdirSync: typeof fs.mkdirSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  globSync: StateGlobSync;
  createWatcher: typeof chokidar.watch;
  createDebounce: StateDebounce;
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface StatesCoreBuildOptions {
  projectRoot: string;
  isWatch?: boolean;
}

export type StatesCoreRunResult = StateBuildResult | StateWatcher;

export const defaultStatesCoreDependencies: StatesCoreDependencies = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  globSync: glob.sync,
  createWatcher: chokidar.watch,
  createDebounce: (callback, wait) => debounce(callback, wait),
  log: console.log.bind(console),
};

const getStateGlobPattern = (projectRoot: string): string => slash(path.resolve(projectRoot, 'src/**/*.states.json'));

const getStateOutputPath = (projectRoot: string): string => path.resolve(projectRoot, 'public/pl-states.json');

export const aggregateStates = (
  states: Record<string, string | undefined>,
  dependencies: Pick<StatesCoreDependencies, 'log'>
): StateAggregationResult => {
  const output: unknown[] = [];
  const errors: StateParseError[] = [];

  Object.keys(states)
    .sort()
    .forEach((filePath) => {
      const state = states[filePath];

      if (state === undefined) {
        return;
      }

      try {
        output.push(JSON.parse(state));
      } catch (error) {
        dependencies.log(error);
        errors.push({ filePath, error });
      }
    });

  return { output, errors };
};

export const writeStates = (
  output: unknown[],
  outputPath: string,
  dependencies: Pick<StatesCoreDependencies, 'existsSync' | 'mkdirSync' | 'writeFileSync'>
): void => {
  const outputDir = path.dirname(outputPath);

  if (!dependencies.existsSync(outputDir)) {
    dependencies.mkdirSync(outputDir, { recursive: true });
  }

  dependencies.writeFileSync(outputPath, JSON.stringify(output, null, '  '));
};

export const buildStatesOnce = (projectRoot: string, dependencies: StatesCoreDependencies = defaultStatesCoreDependencies): StateBuildResult => {
  const states: Record<string, string> = {};

  dependencies.globSync(getStateGlobPattern(projectRoot)).forEach((statePath) => {
    states[statePath] = dependencies.readFileSync(statePath, 'utf-8') as string;
  });

  const result = aggregateStates(states, dependencies);

  if (result.errors.length > 0) {
    return { ok: false, errors: result.errors };
  }

  writeStates(result.output, getStateOutputPath(projectRoot), dependencies);

  return { ok: true, errors: [] };
};

export const watchStates = (projectRoot: string, dependencies: StatesCoreDependencies = defaultStatesCoreDependencies): StateWatcher => {
  const states: Record<string, string> = {};
  const outputPath = getStateOutputPath(projectRoot);
  const buildStates = dependencies.createDebounce(() => {
    // Watch mode intentionally keeps log-and-continue semantics: malformed state
    // files are reported but do not stop the watcher or block valid state output.
    const result = aggregateStates(states, dependencies);

    writeStates(result.output, outputPath, dependencies);
  }, 500);
  // The initial glob reports slash paths while chokidar reports native and
  // possibly relative paths (`D:\\...` on Windows). Key every event by one
  // slash-normalized absolute path so `unlink` removes the entry `add`/glob
  // created instead of leaving stale state in the generated output.
  const toStateKey = (statePath: string): string => slash(path.resolve(projectRoot, statePath));
  const setStates = (statePath: string): void => {
    const key = toStateKey(statePath);

    states[key] = dependencies.readFileSync(key, 'utf-8') as string;
    buildStates();
  };
  const removeStates = (statePath: string): void => {
    delete states[toStateKey(statePath)];
    buildStates();
  };
  const globPattern = getStateGlobPattern(projectRoot);

  const initialStatePaths = dependencies.globSync(globPattern);

  initialStatePaths.forEach((statePath) => setStates(statePath));

  if (initialStatePaths.length === 0) {
    // Watch mode should still clear stale generated output when a project starts
    // with no state files; add/change/unlink events keep scheduling later builds.
    buildStates();
  }

  const watcher = dependencies.createWatcher(globPattern);

  watcher
    .on('ready', () => {
      dependencies.log('States are ready!');
    })
    .on('add', (statePath) => setStates(statePath))
    .on('change', (statePath) => setStates(statePath))
    .on('unlink', (statePath) => removeStates(statePath));

  return watcher;
};

export const runStatesCoreBuild = (
  options: StatesCoreBuildOptions,
  dependencies: StatesCoreDependencies = defaultStatesCoreDependencies
): StatesCoreRunResult => {
  if (options.isWatch) {
    return watchStates(options.projectRoot, dependencies);
  }

  return buildStatesOnce(options.projectRoot, dependencies);
};
