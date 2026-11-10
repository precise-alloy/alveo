import type { PluginOption } from 'vite';

import MagicString, { SourceMapOptions } from 'magic-string';

import {
  FUNCTIONS_IMPORT_STATEMENT,
  FUNCTIONS_PLACEHOLDER,
  RESOLVED_VIRTUAL_FUNCTIONS_ID,
  VIRTUAL_FUNCTIONS_ID,
  containsFunctionsPlaceholder,
  getFunctionsSourcePath,
  loadFunctionsSource,
} from './inject-functions-core.ts';

const injectFunctions = (): PluginOption => {
  const functionsSourcePath = getFunctionsSourcePath();
  let cachedSource: string | undefined;

  return {
    name: 'alveo-inject-functions',
    enforce: 'pre',

    buildStart() {
      cachedSource = undefined;
    },

    watchChange(id) {
      if (id === functionsSourcePath) cachedSource = undefined;
    },

    resolveId(id) {
      if (id === VIRTUAL_FUNCTIONS_ID || id.startsWith(VIRTUAL_FUNCTIONS_ID + '?')) {
        return '\0' + id;
      }

      return undefined;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_FUNCTIONS_ID && !id.startsWith(RESOLVED_VIRTUAL_FUNCTIONS_ID + '?')) {
        return undefined;
      }

      this.addWatchFile(functionsSourcePath);

      return (cachedSource ??= loadFunctionsSource(functionsSourcePath));
    },

    transform(code, id) {
      const cleanId = id.split('?', 1)[0]!;

      if (cleanId === functionsSourcePath || id.startsWith(RESOLVED_VIRTUAL_FUNCTIONS_ID) || !containsFunctionsPlaceholder(code)) {
        return undefined;
      }

      this.addWatchFile(functionsSourcePath);

      // Replace the placeholder with an ESM import rather than inline statements.
      // In ES modules, static `import './api'` declarations hoist above top-level
      // statements in the same file, which previously caused `api.ts` and `main.ts`
      // to evaluate before `functions.ts` defined `getModifiers`, `viteAbsoluteUrl`,
      // and `getCookie`. Emitting an import at the placeholder position preserves
      // top-to-bottom ESM import evaluation order so `functions.ts` runs first.
      const magicString = new MagicString(code);

      magicString.replaceAll(FUNCTIONS_PLACEHOLDER, FUNCTIONS_IMPORT_STATEMENT);

      const sourcemapOptions: SourceMapOptions = {
        source: cleanId,
        file: cleanId + '.map',
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
