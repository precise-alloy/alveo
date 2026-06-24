type AssetPathInfo = {
  name?: string;
  ext: string;
  noHash?: boolean;
};

export type PreRenderedAsset = {
  name?: string;
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
  return getAssetPath({ name: chunkInfo.name, ext: 'css' });
};

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
