import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import path from 'path';

import { glob } from 'glob';

import { getPackageRoot } from '../paths.ts';

const options = (context: AlveoContext): PluginOption => {
  const scriptOnly = process.env.scriptOnly;

  const getSiteInputs = (): Record<string, string> => {
    const inputs: Record<string, string> = {};
    const packageRoot = getPackageRoot();

    if (!scriptOnly) {
      inputs['index'] = `${context.projectRoot}/index.html`;
    }

    // Scan consumer's entry files and alveo package's own script entries.
    // All patterns must be absolute — glob's `root` option rewrites
    // `/`-prefixed patterns on Linux, which corrupts absolute packageRoot paths.
    const filePaths = glob.sync([
      `${context.projectRoot}/src/assets/**/*.entry.{js,jsx,ts,tsx}`,
      `${packageRoot}/dist/scripts/**/*.entry.js`,
      `${packageRoot}/src/scripts/**/*.entry.{js,jsx,ts,tsx}`,
    ]);

    [].forEach.call(filePaths, (filePath: string) => {
      const fileName = path.basename(filePath).toLowerCase();
      const entryName = fileName.replace(/\.entry\.(?:js|jsx|ts|tsx)$/gi, '');

      if (entryName === 'mock-api' && context.mode === 'production') {
        return;
      }

      if (entryName != fileName) {
        inputs[entryName] = filePath;

        return;
      }
    });

    return inputs;
  };

  return {
    name: 'alveo-options',
    enforce: 'pre',

    options(options) {
      if (typeof options.input === 'string' && options.input.includes('entry-server')) {
        return options;
      }

      options.input = getSiteInputs();
    },
  };
};

export default options;
