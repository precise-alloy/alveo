type AssetPathInfo = {
  name?: string;
  ext: string;
  noHash?: boolean;
};

export type PreRenderedAsset = {
  name?: string;
  names?: string[];
};

export type PreRenderedChunk = {
  name?: string;
};

/**
 * Converts a string to lower-case words separated by dashes.
 * Replaces lodash's `_.lowerCase` + whitespace normalization.
 */
const toLowerDashed = (input: string): string =>
  input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

const getAssetPath = ({ name, ext, noHash }: AssetPathInfo): string => {
  const normalizedName = toLowerDashed(name ?? '');

  if (noHash) {
    return `assets/js/${normalizedName}.${ext}`;
  }

  return `assets/js/${normalizedName}.0x[hash].${ext}`;
};

export const getAssetFileName = (chunkInfo: PreRenderedAsset): string => {
  const { name, ext } = path.posix.parse((chunkInfo.names?.[0] ?? chunkInfo.name ?? 'asset').replaceAll('\\', '/'));
  const extension = ext.toLowerCase();
  const directory =
    extension === '.css'
      ? 'assets/css'
      : ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico'].includes(extension)
        ? 'assets/images'
        : ['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(extension)
          ? 'assets/fonts'
          : extension === '.js'
            ? 'assets/js'
            : 'assets';

  return `${directory}/${toLowerDashed(name)}.0x[hash]${ext}`;
};

/**
 * Glob ignore patterns shared by every script-entry discovery path (Vite
 * `alveo-options` inputs and the standalone esbuild script build). Keeping one
 * list prevents test/spec entries or __tests__/__mocks__ fixtures from being
 * shipped by one pipeline while the other excludes them.
 */
export const SCRIPT_ENTRY_IGNORE_PATTERNS: readonly string[] = ['**/*.{test,spec}.entry.*', '**/{__tests__,__mocks__}/**'];

export const getScriptEntryName = (file: string): string =>
  toLowerDashed(path.posix.basename(file.replaceAll('\\', '/')).replace(/\.entry\.[jt]sx?$/i, ''));

export const getEntryFileName = (chunkInfo: PreRenderedChunk): string => {
  if (chunkInfo.name === 'entry-server') {
    return chunkInfo.name + '.js';
  }

  if (chunkInfo.name === 'index' || chunkInfo.name === 'react-loader') {
    return 'assets/js/react-loader.0x[hash].js';
  }

  return getAssetPath({ name: chunkInfo.name, ext: 'js', noHash: true });
};

export const getChunkFileName = (chunkInfo: PreRenderedChunk): string => {
  return getAssetPath({ name: chunkInfo.name, ext: 'js' });
};
import path from 'node:path';
