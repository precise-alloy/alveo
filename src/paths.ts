import path from 'path';
import { fileURLToPath } from 'url';

import slash from 'slash';
import { loadEnv } from 'vite';

/**
 * Returns the alveo package's own root directory.
 * Used for framework-internal resources (styles, scripts, root templates).
 */
export function getPackageRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  // In development: packages/alveo/src/ -> packages/alveo/
  // When published: node_modules/alveo/dist/ -> node_modules/alveo/
  return slash(path.resolve(currentDir, '..'));
}

export type AlveoPaths = {
  root: string;
  srcRoot: string;
  outDir: string;
  viteSharedRoot: string;
  alveoEnv: Record<string, string>;
  mode: string;
};

/**
 * Creates path configuration resolved relative to the consumer's project root.
 *
 * @param projectRoot - Absolute path to the consumer project's root directory
 * @param mode - Vite mode for environment variable loading (defaults to 'production')
 */
export function createPaths(projectRoot: string, mode?: string): AlveoPaths {
  const resolvedMode = mode ?? resolveMode();
  const root = slash(path.resolve(projectRoot));
  const alveoEnv = loadEnv(resolvedMode, root);
  const packageRoot = getPackageRoot();

  return {
    root,
    srcRoot: slash(path.resolve(root, 'src')),
    outDir: slash(path.resolve(root, 'dist')),
    viteSharedRoot: slash(path.resolve(packageRoot, 'src/shared')),
    alveoEnv,
    mode: resolvedMode,
  };
}

/**
 * Resolves a path to an absolute path relative to the given project root.
 * Already-absolute paths are returned normalized.
 */
export function getAbsolutePath(p: string, projectRoot: string): string {
  return path.isAbsolute(p) ? slash(p) : slash(path.resolve(projectRoot, p));
}

function resolveMode(): string {
  const argvModeIndex = process.argv.indexOf('--mode');

  if (argvModeIndex >= 0 && argvModeIndex < process.argv.length - 1 && !process.argv[argvModeIndex + 1]!.startsWith('-')) {
    return process.argv[argvModeIndex + 1]!;
  }

  return 'production';
}

export { slash };
