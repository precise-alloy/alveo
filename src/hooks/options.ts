import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import path from 'path';
import fs from 'node:fs';

import { glob } from 'glob';

import { getPackageRoot } from '../paths.ts';
import { getScriptEntryName } from '../filename.ts';

export const isMockApiEnabled = (context: AlveoContext): boolean =>
  context.mode !== 'production' && glob.sync(`${context.projectRoot}/src/mocks/handlers{,/index}.{js,jsx,ts,tsx}`).length > 0;

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
    const frameworkScripts = fs.existsSync(path.join(packageRoot, 'dist/scripts'))
      ? 'dist/scripts/**/*.entry.js'
      : 'src/scripts/**/*.entry.{js,jsx,ts,tsx}';
    const filePaths = glob.sync([`${context.projectRoot}/src/assets/**/*.entry.{js,jsx,ts,tsx}`, `${packageRoot}/${frameworkScripts}`]);

    [].forEach.call(filePaths, (filePath: string) => {
      const entryName = getScriptEntryName(filePath);

      if (entryName === 'mock-api' && !isMockApiEnabled(context)) {
        return;
      }

      if (inputs[entryName]) {
        throw new Error(`Duplicate script entry "${entryName}": ${inputs[entryName]} and ${filePath}`);
      }

      inputs[entryName] = filePath;
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
