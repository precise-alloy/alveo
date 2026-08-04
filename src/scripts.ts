import type { ScriptBuildResult } from './scripts-core.ts';

import { compileDiscoveredScripts } from './scripts-core.ts';

export { runScriptBuild } from './scripts-core.ts';
export type { ScriptBuildResult, ScriptCoreDependencies } from './scripts-core.ts';

/**
 * Runs the script build pipeline for a consumer project.
 * Scans consumer's `src/assets/scripts/**\/*.entry.ts` and outputs to
 * consumer's `public/assets/js/`.
 *
 * @param projectRoot - Absolute path to the consumer's project root
 */
export const runScripts = async (projectRoot: string): Promise<ScriptBuildResult> => {
  return compileDiscoveredScripts(projectRoot);
};
