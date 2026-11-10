import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import MagicString, { SourceMapOptions } from 'magic-string';

import { ASSET_HASH_REGEX, createAppendAssetHash, createDefaultAssetHashDependencies } from '../asset-hash.ts';

/**
 * Detects pure barrel re-export modules (`export { ... } from '...'` or
 * `export * from '...'` with no executable statements). Marking them
 * side-effect-free lets Rolldown link callers directly to the re-exported
 * target chunk (such as `react-loader`) instead of emitting tiny empty barrel
 * chunks like `require-css.0x[hash].js`.
 */
export const isPureReexportModule = (code: string): boolean => {
  const stripped = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim();

  return (
    stripped.length > 0 &&
    /^(?:export\s+(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from|type\s*\{[^}]*\}\s*from|\{[^}]*\}\s*from)\s*['"][^'"]+['"]\s*;?\s*)+$/.test(stripped)
  );
};

const transform = (context: AlveoContext): PluginOption => {
  const assetHashDeps = createDefaultAssetHashDependencies(context.projectRoot);
  const appendAssetHash = createAppendAssetHash(assetHashDeps);

  return {
    name: 'alveo-transform',
    enforce: 'post',

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transform(code, id, options?) {
      // ?url modules already contain Vite-managed URLs. Their filesystem paths
      // may contain "/assets/" without referring to the consumer's public dir.
      if (/[?&]url(?:[&#]|$)/.test(id)) return undefined;

      // Published Alveo lives in node_modules too, so a blanket dependency skip
      // would bypass its own asset URLs and development-only markers.
      if (
        !code.includes('/assets/') &&
        !code.includes('VITE_EXTENSION_UNIQUE_ID') &&
        !(context.mode === 'production' && code.includes('ALVEO_BEGIN_DEVELOPMENT_ONLY'))
      ) {
        return isPureReexportModule(code) ? { code, map: null, moduleSideEffects: false } : undefined;
      }

      const magicString = new MagicString(code);

      if (context.mode === 'production' && code.includes('/* ALVEO_BEGIN_DEVELOPMENT_ONLY */')) {
        magicString.replaceAll(/\/\* ALVEO_BEGIN_DEVELOPMENT_ONLY \*\/[\s\S]*?\/\* ALVEO_END_DEVELOPMENT_ONLY \*\//g, '');
      }

      magicString.replaceAll('VITE_EXTENSION_UNIQUE_ID', context.env.VITE_EXTENSION_UNIQUE_ID ?? '').replaceAll(ASSET_HASH_REGEX, appendAssetHash);

      const newCode = magicString.toString();

      // Skip the expensive source map generation for no-op transforms, where
      // the map would be discarded together with the unchanged code.
      if (newCode === code) {
        return isPureReexportModule(code) ? { code, map: null, moduleSideEffects: false } : undefined;
      }

      const cleanId = id.split('?', 1)[0]!;
      const sourcemapOptions: SourceMapOptions = { source: cleanId, file: cleanId + '.map', includeContent: false, hires: true };

      return {
        code: newCode,
        map: magicString.generateMap(sourcemapOptions),
      };
    },
  };
};

export default transform;
