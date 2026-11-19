import path from 'node:path';

import { getAssetVersion } from './cryptography.ts';
import { isTextLikeContent, isTextLikePath, normalizeTextFileContent } from './text-normalization.ts';

type AssetPathInfo = {
  name?: string;
  ext: string;
  noHash?: boolean;
};

export type PreRenderedAsset = {
  name?: string;
  names?: string[];
  source?: string | Uint8Array;
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

// Validate the bytes Rolldown will emit regardless of how the plugin supplied
// them. Generated scripts/styles can still contain bundler URL placeholders.
const getCanonicalAssetText = (file: string, source: PreRenderedAsset['source']): string | undefined => {
  if (source === undefined || !isTextLikePath(file)) return undefined;
  if (typeof source === 'string' && /\.(?:[cm]?js|jsx|tsx?|s?css)(?:[?#]|$)/i.test(file)) return undefined;
  const bytes = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source.buffer, source.byteOffset, source.byteLength);

  return isTextLikeContent(bytes) ? normalizeTextFileContent(file, bytes.toString('utf8'), true) : undefined;
};

export const getOutputAssetText = (asset: { names: string[]; fileName: string; source: string | Uint8Array }): string | undefined => {
  const name = asset.names[0];
  // Rolldown gives both anonymous and explicit fileName-only emissions empty
  // names. It may add a numeric suffix (asset2, ...) to avoid a collision.
  const anonymous = name === undefined && /^assets\/asset\d*\.0x([\w-]+)$/.exec(asset.fileName);

  if (anonymous) {
    const text = getCanonicalAssetText('asset', asset.source);

    return text !== undefined && getAssetVersion(text) === anonymous[1] ? text : undefined;
  }

  return getCanonicalAssetText(name ?? asset.fileName, asset.source);
};

export const getAssetFileName = (chunkInfo: PreRenderedAsset): string => {
  const file = (chunkInfo.names?.[0] ?? chunkInfo.name ?? 'asset').replaceAll('\\', '/');
  const { name, ext } = path.posix.parse(file);
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

  const text = getCanonicalAssetText(file, chunkInfo.source);

  return `${directory}/${toLowerDashed(name)}.0x${text === undefined ? '[hash]' : getAssetVersion(text)}${ext}`;
};

/**
 * Glob ignore patterns shared by every script-entry discovery path (Vite
 * `alveo-options` inputs and the standalone Rolldown script build). Keeping one
 * list prevents test/spec entries or __tests__/__mocks__ fixtures from being
 * shipped by one pipeline while the other excludes them.
 */
export const SCRIPT_ENTRY_IGNORE_PATTERNS: readonly string[] = ['**/*.{test,spec}.entry.*', '**/{__tests__,__mocks__}/**'];

export const getScriptEntryName = (file: string): string =>
  toLowerDashed(path.posix.basename(file.replaceAll('\\', '/')).replace(/\.entry\.[jt]sx?$/i, ''));

/**
 * Checks whether a module path is a standalone `*.entry.{js,jsx,ts,tsx}` script
 * with a non-empty entry basename.
 */
export const isScriptEntry = (file: string): boolean => {
  const cleanPath = file.split('?', 1)[0]!;

  return /\.entry\.[jt]sx?$/i.test(cleanPath) && Boolean(getScriptEntryName(cleanPath));
};

/**
 * Removes the internal `alveo-entry` module-isolation query parameter from
 * sourcemap paths so emitted `.map` files reference the original source files.
 */
export const stripEntryIsolationQuery = (sourcePath: string): string =>
  sourcePath.replace(/([?&])alveo-entry=[^&#]+(&|$)/g, (_, prefix: string, suffix: string) => (suffix ? prefix : ''));

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
