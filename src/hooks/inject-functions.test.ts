// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import injectFunctions from './inject-functions.js';
import { FUNCTIONS_PLACEHOLDER, getFunctionsSourcePath } from './inject-functions-core.js';

vi.mock('./inject-functions-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inject-functions-core.js')>();

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

  describe('transform()', () => {
    it('returns undefined when code does not contain the placeholder', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };

      const result = plugin.transform.call(context, 'const x = 1;', '/some/file.ts');

      expect(result).toBeUndefined();
    });

    it('returns undefined when the id matches the functions source path itself', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const functionsPath = getFunctionsSourcePath();
      const codeWithPlaceholder = `before\n${FUNCTIONS_PLACEHOLDER}\nafter`;

      const result = plugin.transform.call(context, codeWithPlaceholder, functionsPath);

      expect(result).toBeUndefined();
    });

    it('replaces placeholder with function source and returns code + map', () => {
      const plugin = createPlugin();
      const context = { addWatchFile: vi.fn() };
      const codeWithPlaceholder = `before\n${FUNCTIONS_PLACEHOLDER}\nafter`;

      const result = plugin.transform.call(context, codeWithPlaceholder, '/project/src/entry.ts');

      expect(result).toBeDefined();
      expect(result!.code).toContain('// injected functions source');
      expect(result!.code).not.toContain(FUNCTIONS_PLACEHOLDER);
      expect(result!.code).toContain('before');
      expect(result!.code).toContain('after');
      expect(result!.map).toBeDefined();
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
      const occurrences = result!.code.split('// injected functions source').length - 1;

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
