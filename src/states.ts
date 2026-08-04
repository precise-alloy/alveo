import { runStatesCoreBuild, StatesCoreDependencies, StatesCoreRunResult } from './states-core.ts';

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
export const runStatesBuild = (options: StatesBuildOptions, dependencies?: StatesCoreDependencies): StatesCoreRunResult => {
  return runStatesCoreBuild(options, dependencies);
};

export type { StateBuildResult, StateParseError, StatesCoreDependencies, StatesCoreRunResult } from './states-core.ts';
