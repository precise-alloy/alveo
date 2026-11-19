import fs from 'fs';
import path from 'path';

import slash from 'slash';

import { getAssetVersion } from './cryptography.ts';
import { normalizeTextLikeContent } from './text-normalization.ts';

// Regex that matches `/assets/<path>.<ext>` URLs we want to cache-bust.
//
// Extensions cover the union of what CSS and JS/TS modules can reference:
// fonts (ttf/otf/woff/woff2), raster images (png/webp/jpg/jpeg/gif) and
// vector images (svg).
const publicAssetPath = String.raw`/assets/[a-z0-9./_-]+\.(?:svg|ttf|otf|woff2?|eot|png|webp|jpe?g|gif|avif|ico)`;

export const ASSET_HASH_REGEX = new RegExp(publicAssetPath + String.raw`\b\??`, 'gi');
// Lightning CSS supplies one parsed URL, not arbitrary source text. Only
// version a complete root-relative public path; preserve queries and SVG IDs.
const cssAssetPath = new RegExp('^' + publicAssetPath + '(?=#|$)', 'i');

export type AssetHashDependencies = {
  existsSync: typeof fs.existsSync;
  readFileSync: (filePath: string) => Buffer;
  hash: typeof getAssetVersion;
  resolveAssetPath: (assetUrl: string) => string;
  cache: Record<string, string>;
  logMissing: (absPath: string) => void;
};

/**
 * Creates default asset hash dependencies resolved against the given project root.
 *
 * @param projectRoot - Absolute path to the consumer project root
 */
export const createDefaultAssetHashDependencies = (projectRoot: string): AssetHashDependencies => ({
  existsSync: fs.existsSync,
  readFileSync: (filePath: string) => fs.readFileSync(filePath),
  hash: getAssetVersion,
  resolveAssetPath: (assetUrl: string) => slash(path.resolve(projectRoot, 'public' + assetUrl)),
  cache: {},
  logMissing: (absPath: string) => console.error(`File not found: ${absPath}`),
});

/**
 * Pure builder for the `appendAssetHash` replacer. Tests inject their own
 * `AssetHashDependencies` so the cache, fs, and logging can be observed
 * without touching real disk or mutating the shared production cache.
 */
export const createAppendAssetHash =
  (dependencies: AssetHashDependencies) =>
  (assetUrl: string): string => {
    if (assetUrl.includes('?')) {
      // Already versioned (or has any query string) -- leave it alone.
      return assetUrl;
    }

    const cached = dependencies.cache[assetUrl];

    if (cached) {
      return assetUrl + '?v=' + cached;
    }

    const absPath = dependencies.resolveAssetPath(assetUrl);

    if (dependencies.existsSync(absPath)) {
      const content = normalizeTextLikeContent(assetUrl, dependencies.readFileSync(absPath));
      const hash = dependencies.hash(content);

      dependencies.cache[assetUrl] = hash;

      return assetUrl + '?v=' + hash;
    }

    dependencies.logMissing(absPath);

    return assetUrl;
  };

/**
 * Convenience wrapper that runs `appendAssetHash` over every matching URL
 * in a string. Used by CSS post-processing where we operate on the raw
 * compiled output (no MagicString involved).
 */
export const rewriteAssetHashes = (input: string, dependencies: AssetHashDependencies): string =>
  input.replaceAll(ASSET_HASH_REGEX, createAppendAssetHash(dependencies));

export const createCssAssetUrlRewriter = (dependencies: AssetHashDependencies) => {
  const append = createAppendAssetHash(dependencies);

  return (url: string): string => url.replace(cssAssetPath, append);
};
