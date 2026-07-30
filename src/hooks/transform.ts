import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import MagicString, { SourceMapOptions } from 'magic-string';

import { ASSET_HASH_REGEX, createAppendAssetHash, createDefaultAssetHashDependencies } from '../asset-hash.ts';

const transform = (context: AlveoContext): PluginOption => {
  const assetHashDeps = createDefaultAssetHashDependencies(context.projectRoot);
  const appendAssetHash = createAppendAssetHash(assetHashDeps);

  return {
    name: 'alveo-transform',
    enforce: 'post',

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transform(code, id, options?) {
      const magicString = new MagicString(code);

      if (context.mode === 'production' && code.includes('/* ALVEO_BEGIN_DEVELOPMENT_ONLY */')) {
        magicString.replaceAll(/\/\* ALVEO_BEGIN_DEVELOPMENT_ONLY \*\/[\s\S]*?\/\* ALVEO_END_DEVELOPMENT_ONLY \*\//g, '');
      }

      magicString.replaceAll('VITE_EXTENSION_UNIQUE_ID', context.env.VITE_EXTENSION_UNIQUE_ID ?? '').replaceAll(ASSET_HASH_REGEX, appendAssetHash);

      const newCode = magicString.toString();

      // Skip the expensive source map generation for no-op transforms, where
      // the map would be discarded together with the unchanged code.
      if (newCode === code) {
        return undefined;
      }

      const sourcemapOptions: SourceMapOptions = { source: id, file: id + '.map', includeContent: false, hires: true };

      return {
        code: newCode,
        map: magicString.generateMap(sourcemapOptions),
      };
    },
  };
};

export default transform;
