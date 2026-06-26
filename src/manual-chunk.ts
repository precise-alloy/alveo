import path from 'path';

import slash from 'slash';

import { getAbsolutePath } from './paths.ts';

type ManualChunkMeta = {
  getModuleInfo: (id: string) => ModuleInfo | null;
};

type ModuleInfo = {
  isEntry: boolean;
};

const getInternalName = (id: string, api: ManualChunkMeta, srcRoot: string, projectRoot: string): string | null | void => {
  const moduleInfo = api.getModuleInfo(id);

  if (!moduleInfo?.isEntry) {
    return;
  }

  const entryPath = getAbsolutePath(id, projectRoot);

  if (entryPath.startsWith(srcRoot)) {
    const relativePath = slash(path.relative(srcRoot, entryPath));
    const match = /^([a-z0-9.@_-]+?)\/([a-z0-9.@_-]+?)(\.[^.]+)$/gi.exec(relativePath);

    if (match) {
      return match[1] + '~' + match[2];
    }
  }
};

const getExternalName = (_: string): string | null | void => {
  // Reserved for future vendor chunk splitting
};

/**
 * Creates a `manualChunks` function for Rolldown/Rollup output config.
 *
 * @param srcRoot - Absolute path to the consumer project's `src/` directory
 * @param projectRoot - Absolute path to the consumer project root
 */
export const createManualChunk =
  (srcRoot: string, projectRoot: string) =>
  (id: string, api: ManualChunkMeta): string | null | void => {
    if (id.includes('node_modules/')) {
      return getExternalName(id);
    } else {
      return getInternalName(id, api, srcRoot, projectRoot);
    }
  };
