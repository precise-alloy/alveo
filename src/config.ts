import type { BuildOptions, CSSOptions, PluginOption, UserConfig } from 'vite';
import type { AlveoContext } from './hooks/types.ts';

import react from '@vitejs/plugin-react';
import { loadEnv, mergeConfig } from 'vite';

import { createAliases } from './alias.ts';
import { getAssetFileName, getChunkFileName, getEntryFileName } from './filename.ts';
import { createManualChunk } from './manual-chunk.ts';
import { createPaths, getPackageRoot } from './paths.ts';
import { virtualModules } from './virtual-modules.ts';
import handleHotUpdate from './hooks/handle-hot-update.ts';
import injectFunctions from './hooks/inject-functions.ts';
import options from './hooks/options.ts';
import transform from './hooks/transform.ts';
import transformIndexHtml from './hooks/transform-index-html.ts';

export type AlveoConfigOptions = {
  /** Consumer's project root (default: process.cwd()) */
  root?: string;
  /** Vite mode */
  mode?: string;
  /** Base URL override */
  base?: string;
  /** Additional Vite plugins */
  plugins?: PluginOption[];
  /** Build overrides */
  build?: BuildOptions;
  /** CSS overrides */
  css?: CSSOptions;
};

/**
 * Creates a fully configured Vite config for alveo projects.
 *
 * Consumers call this in their `vite.config.ts`:
 * ```ts
 * import { defineAlveoConfig } from 'alveo';
 * export default defineAlveoConfig({ root: __dirname });
 * ```
 */
export function defineAlveoConfig(userOptions?: AlveoConfigOptions): UserConfig {
  const projectRoot = userOptions?.root ?? process.cwd();
  const paths = createPaths(projectRoot, userOptions?.mode);
  const aliases = createAliases(projectRoot);
  const baseUrl = userOptions?.base ?? paths.alveoEnv.VITE_BASE_URL;

  const context: AlveoContext = {
    projectRoot: paths.root,
    packageRoot: getPackageRoot(),
    srcRoot: paths.srcRoot,
    outDir: paths.outDir,
    env: paths.alveoEnv,
    mode: paths.mode,
  };

  const manualChunks = createManualChunk(paths.srcRoot, paths.root);

  const defaultPlugins: PluginOption[] = [
    {
      name: 'alveo-context',
      config(inputConfig, configEnv) {
        // Library configuration is evaluated before Vite resolves its mode.
        // Use the actual invocation, not import-time argv or NODE_ENV guesses.
        context.mode = userOptions?.mode ?? configEnv.mode;
        context.env = loadEnv(context.mode, paths.root);

        // Precedence: inline Vite config/CLI `--base` (already merged into
        // `inputConfig` by Vite) > defineAlveoConfig({ base }) > mode env > '/'.
        // The returned UserConfig deliberately omits `base` when the consumer
        // did not pass one, so a defined `inputConfig.base` here is always explicit
        // and must not be replaced by the import-time or mode environment.
        if (inputConfig.base !== undefined) {
          return;
        }

        return { base: context.env.VITE_BASE_URL ?? '/' };
      },
    },
    react(),
    virtualModules(),
    options(context),
    injectFunctions(),
    transform(context),
    transformIndexHtml(baseUrl ?? '/', context),
    handleHotUpdate(),
  ];

  const consumerPlugins = userOptions?.plugins ?? [];

  const config: UserConfig = {
    // Only an explicit consumer base is part of the static config. The env
    // default is resolved in `alveo-context` for the actual Vite mode so it can
    // never masquerade as an explicit base and override CLI/inline values.
    ...(userOptions?.base === undefined ? {} : { base: userOptions.base }),
    plugins: [...defaultPlugins, ...consumerPlugins],
    assetsInclude: ['**/*.svg', '**/*.htm', '**/*.cshtml'],
    server: {
      fs: {
        allow: [paths.root, context.packageRoot],
      },
    },
    build: {
      rolldownOptions: {
        output: {
          entryFileNames: getEntryFileName,
          chunkFileNames: getChunkFileName,
          assetFileNames: getAssetFileName,
          manualChunks,
        },
      },
      minify: 'oxc',
      sourcemap: true,
      outDir: paths.outDir,
      emptyOutDir: true,
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
    },
    resolve: {
      alias: aliases,
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
  };

  return mergeConfig(config, { build: userOptions?.build, css: userOptions?.css });
}
