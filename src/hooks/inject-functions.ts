import type { PluginOption } from 'vite';

import MagicString, { SourceMapOptions } from 'magic-string';

import { FUNCTIONS_PLACEHOLDER, containsFunctionsPlaceholder, getFunctionsSourcePath, loadFunctionsSource } from './inject-functions-core.js';

const injectFunctions = (): PluginOption => {
  const functionsSourcePath = getFunctionsSourcePath();

  return {
    name: 'alveo-inject-functions',
    enforce: 'pre',

    transform(code, id) {
      if (id === functionsSourcePath || !containsFunctionsPlaceholder(code)) {
        return undefined;
      }

      this.addWatchFile(functionsSourcePath);

      const replacement = loadFunctionsSource(functionsSourcePath);
      const magicString = new MagicString(code);

      magicString.replaceAll(FUNCTIONS_PLACEHOLDER, replacement);

      const sourcemapOptions: SourceMapOptions = {
        source: id,
        file: id + '.map',
        includeContent: false,
        hires: true,
      };

      return {
        code: magicString.toString(),
        map: magicString.generateMap(sourcemapOptions),
      };
    },
  };
};

export default injectFunctions;
