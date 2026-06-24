import { runScriptBuild } from './scripts-core.js';

export { runScriptBuild } from './scripts-core.js';
export type { ScriptCoreDependencies } from './scripts-core.js';

/**
 * Runs the script build pipeline for a consumer project.
 * Scans consumer's `src/assets/scripts/**\/*.entry.ts` and outputs to
 * consumer's `public/assets/js/`.
 *
 * @param projectRoot - Absolute path to the consumer's project root
 */
export const runScripts = async (projectRoot: string): Promise<void> => {
  await runScriptBuild(projectRoot);
};
