import type { PluginOption } from 'vite';

const resolveDynamicImport = (): PluginOption => {
  return {
    name: 'alveo-resolve-dynamic-import',
    enforce: 'post',

    resolveDynamicImport(_specifier: unknown, _importer: unknown) {
      // No-op lifecycle hook — reserved for future dynamic import resolution
    },
  };
};

export default resolveDynamicImport;
