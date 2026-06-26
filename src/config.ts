import type { BuildOptions, CSSOptions, PluginOption, UserConfig } from 'vite';
import type { AlveoContext } from './hooks/types.ts';

import react from '@vitejs/plugin-react';

import { createAliases } from './alias.ts';
import { getAssetFileName, getChunkFileName, getEntryFileName } from './filename.ts';
import { createManualChunk } from './manual-chunk.ts';
import { createPaths, getPackageRoot } from './paths.ts';
import { virtualModules } from './virtual-modules.ts';
import buildStart from './hooks/build-start.ts';
import closeBundle from './hooks/close-bundle.ts';
import handleHotUpdate from './hooks/handle-hot-update.ts';
import injectFunctions from './hooks/inject-functions.ts';
import options from './hooks/options.ts';
import resolveDynamicImport from './hooks/resolve-dynamic-import.ts';
import transform from './hooks/transform.ts';
import transformIndexHtml from './hooks/transform-index-html.ts';
import writeBundle from './hooks/write-bundle.ts';

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
    react(),
    virtualModules(),
    options(context),
    buildStart(),
    injectFunctions(),
    transform(context),
    transformIndexHtml(baseUrl ?? '/'),
    resolveDynamicImport(),
    handleHotUpdate(),
    writeBundle(),
    closeBundle(context),
  ];

  const consumerPlugins = userOptions?.plugins ?? [];

  const config: UserConfig = {
    base: baseUrl,
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
      ...userOptions?.build,
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
      ...userOptions?.css,
    },
    resolve: {
      alias: aliases,
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
  };

  return config;
}
