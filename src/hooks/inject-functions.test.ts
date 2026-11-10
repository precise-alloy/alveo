// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import injectFunctions from './inject-functions.ts';
import {
  FUNCTIONS_IMPORT_STATEMENT,
  FUNCTIONS_PLACEHOLDER,
  RESOLVED_VIRTUAL_FUNCTIONS_ID,
  VIRTUAL_FUNCTIONS_ID,
  getFunctionsSourcePath,
  loadFunctionsSource,
} from './inject-functions-core.ts';

vi.mock('./inject-functions-core.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inject-functions-core.ts')>();

  return {
    ...actual,
    getFunctionsSourcePath: vi.fn().mockReturnValue('/mock/alveo/src/scripts/functions.ts'),
    loadFunctionsSource: vi.fn().mockReturnValue('// injected functions source'),
  };
});

describe('alveo/hooks/inject-functions.ts', () => {
  const createPlugin = () => {
    const plugin = injectFunctions() as {
      name: string;
      enforce: string;
      buildStart: () => void;
      watchChange: (id: string) => void;
      resolveId: (id: string) => string | undefined;
      load: (this: { addWatchFile: (path: string) => void }, id: string) => string | undefined;
      transform: (this: { addWatchFile: (path: string) => void }, code: string, id: string) => { code: string; map: unknown } | undefined;
    };

    return plugin;
  };

  describe('plugin metadata', () => {
    it('has name "alveo-inject-functions"', () => {
      const plugin = createPlugin();

      expect(plugin.name).toBe('alveo-inject-functions');
    });

    it('enforces "pre" order', () => {
      const plugin = createPlugin();

      expect(plugin.enforce).toBe('pre');
    });
  });

  describe('resolveId() and load()', () => {
    it('resolves the virtual functions module with or without entry isolation query parameters', () => {
      const plugin = createPlugin();

      expect(plugin.resolveId(VIRTUAL_FUNCTIONS_ID)).toBe(RESOLVED_VIRTUAL_FUNCTIONS_ID);
      expect(plugin.resolveId(`${VIRTUAL_FUNCTIONS_ID}?alveo-entry=main`)).toBe(`${RESOLVED_VIRTUAL_FUNCTIONS_ID}?alveo-entry=main`);
      expect(plugin.resolveId('/unrelated.ts')).toBeUndefined();
    });

    it('caches loaded functions source per build and invalidates it only on rebuilds or source changes', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };

      vi.mocked(loadFunctionsSource).mockClear();
      plugin.buildStart();
      expect(plugin.load.call(context, '/unrelated.js')).toBeUndefined();
      expect(plugin.load.call(context, RESOLVED_VIRTUAL_FUNCTIONS_ID)).toBe('// injected functions source');
      expect(plugin.load.call(context, `${RESOLVED_VIRTUAL_FUNCTIONS_ID}?alveo-entry=main`)).toBe('// injected functions source');
      plugin.watchChange('/unrelated.js');
      expect(plugin.load.call(context, RESOLVED_VIRTUAL_FUNCTIONS_ID)).toBe('// injected functions source');
      expect(loadFunctionsSource).toHaveBeenCalledOnce();
      expect(context.addWatchFile).toHaveBeenCalledWith('/mock/alveo/src/scripts/functions.ts');
      plugin.watchChange(getFunctionsSourcePath());
      expect(plugin.load.call(context, RESOLVED_VIRTUAL_FUNCTIONS_ID)).toBe('// injected functions source');
      plugin.buildStart();
      expect(plugin.load.call(context, RESOLVED_VIRTUAL_FUNCTIONS_ID)).toBe('// injected functions source');
      expect(loadFunctionsSource).toHaveBeenCalledTimes(3);
    });
  });

  describe('transform()', () => {
    it('returns undefined when code does not contain the placeholder', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };

      const result = plugin.transform.call(context, 'const x = 1;', '/some/file.ts');

      expect(result).toBeUndefined();
    });

    it('returns undefined when the id matches the functions source path or resolved virtual module', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const functionsPath = getFunctionsSourcePath();
      const codeWithPlaceholder = `before\n${FUNCTIONS_PLACEHOLDER}\nafter`;

      expect(plugin.transform.call(context, codeWithPlaceholder, functionsPath)).toBeUndefined();
      expect(plugin.transform.call(context, codeWithPlaceholder, `${functionsPath}?alveo-entry=main`)).toBeUndefined();
      expect(plugin.transform.call(context, codeWithPlaceholder, RESOLVED_VIRTUAL_FUNCTIONS_ID)).toBeUndefined();
    });

    it('replaces placeholder with the virtual functions import statement and returns code + map', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const codeWithPlaceholder = `before\n${FUNCTIONS_PLACEHOLDER}\nafter`;

      const result = plugin.transform.call(context, codeWithPlaceholder, '/project/src/entry.ts?alveo-entry=main');

      expect(result).toBeDefined();
      expect(result!.code).toContain(FUNCTIONS_IMPORT_STATEMENT);
      expect(result!.code).not.toContain(FUNCTIONS_PLACEHOLDER);
      expect(result!.code).toContain('before');
      expect(result!.code).toContain('after');
      expect(result!.map).toMatchObject({ file: 'entry.ts.map', sources: ['entry.ts'] });
    });

    it('calls addWatchFile with the functions source path', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const codeWithPlaceholder = `${FUNCTIONS_PLACEHOLDER}`;

      plugin.transform.call(context, codeWithPlaceholder, '/project/src/entry.ts');

      expect(context.addWatchFile).toHaveBeenCalledWith('/mock/alveo/src/scripts/functions.ts');
    });

    it('replaces all occurrences of the placeholder', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const codeWithMultiplePlaceholders = `${FUNCTIONS_PLACEHOLDER}\nmiddle\n${FUNCTIONS_PLACEHOLDER}`;

      const result = plugin.transform.call(context, codeWithMultiplePlaceholders, '/project/src/entry.ts');

      expect(result).toBeDefined();
      const occurrences = result!.code.split(FUNCTIONS_IMPORT_STATEMENT).length - 1;

      expect(occurrences).toBe(2);
    });

    it('generates a source map with correct source and file', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const codeWithPlaceholder = `${FUNCTIONS_PLACEHOLDER}`;

      const result = plugin.transform.call(context, codeWithPlaceholder, '/project/src/entry.ts');

      expect(result).toBeDefined();
      expect(result!.map).toBeDefined();
    });
  });
});
