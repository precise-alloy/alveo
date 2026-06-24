import type { PluginOption } from 'vite';

const buildStart = (): PluginOption => {
  return {
    name: 'alveo-build-start',
    enforce: 'pre',

    buildStart(_options: unknown) {
      // No-op lifecycle hook — reserved for future pre-build logic
    },
  };
};

export default buildStart;
