import type { PluginOption } from 'vite';

const writeBundle = (): PluginOption => {
  return {
    name: 'alveo-write-bundle',
    enforce: 'post',

    writeBundle(/* options: NormalizedOutputOptions, bundle: OutputBundle */) {
      // No-op lifecycle hook — reserved for future post-write logic
    },
  };
};

export default writeBundle;
