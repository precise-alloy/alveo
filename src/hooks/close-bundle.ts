import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.js';

const closeBundle = (_context: AlveoContext): PluginOption => {
  return {
    name: 'alveo-close-bundle',
    enforce: 'post',

    closeBundle() {
      // Deployment logic will be wired up in a later task (005-migrate-build-pipelines)
    },
  };
};

export default closeBundle;
