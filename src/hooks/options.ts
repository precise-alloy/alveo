import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.js';

import path from 'path';

import { glob } from 'glob';

import { getPackageRoot } from '../paths.js';

const options = (context: AlveoContext): PluginOption => {
  const scriptOnly = process.env.scriptOnly;

  const getSiteInputs = (): Record<string, string> => {
    const inputs: Record<string, string> = {};
    const packageRoot = getPackageRoot();

    if (!scriptOnly) {
      inputs['index'] = `${context.projectRoot}/index.html`;
    }

    // Scan consumer's entry files and alveo package's own script entries
    const filePaths = glob.sync(['/src/assets/**/*.entry.ts', `${packageRoot}/src/scripts/**/*.entry.ts`], { root: context.projectRoot });

    [].forEach.call(filePaths, (filePath: string) => {
      const fileName = path.basename(filePath).toLowerCase();
      const entryName = fileName.replace(/\.entry\.ts$/gi, '');

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
