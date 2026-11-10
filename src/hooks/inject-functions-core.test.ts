// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  FUNCTIONS_IMPORT_STATEMENT,
  FUNCTIONS_PLACEHOLDER,
  RESOLVED_VIRTUAL_FUNCTIONS_ID,
  VIRTUAL_FUNCTIONS_ID,
  containsFunctionsPlaceholder,
  getFunctionsSourcePath,
  loadFunctionsSource,
  InjectFunctionsDependencies,
} from './inject-functions-core.ts';

describe('alveo/hooks/inject-functions-core.ts', () => {
  describe('FUNCTIONS_PLACEHOLDER and virtual module constants', () => {
    it('has the expected constant value', () => {
      expect(FUNCTIONS_PLACEHOLDER).toBe('/* DO NOT REMOVE - AUTO-IMPORTS FUNCTIONS PLACEHOLDER */');
      expect(VIRTUAL_FUNCTIONS_ID).toBe('virtual:alveo/functions');
      expect(RESOLVED_VIRTUAL_FUNCTIONS_ID).toBe('\0virtual:alveo/functions.ts');
      expect(FUNCTIONS_IMPORT_STATEMENT).toBe("import 'virtual:alveo/functions';");
    });

    it('is a non-empty string', () => {
      expect(typeof FUNCTIONS_PLACEHOLDER).toBe('string');
      expect(FUNCTIONS_PLACEHOLDER.length).toBeGreaterThan(0);
    });
  });

  describe('containsFunctionsPlaceholder', () => {
    it('returns true when code contains the placeholder', () => {
      const code = `import foo from 'bar';\n${FUNCTIONS_PLACEHOLDER}\nexport default foo;`;

      expect(containsFunctionsPlaceholder(code)).toBe(true);
    });

    it('returns false when code does not contain the placeholder', () => {
      const code = "import foo from 'bar';\nexport default foo;";

      expect(containsFunctionsPlaceholder(code)).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(containsFunctionsPlaceholder('')).toBe(false);
    });

    it('returns false for partial placeholder match', () => {
      expect(containsFunctionsPlaceholder('/* DO NOT REMOVE')).toBe(false);
    });

    it('returns true when the placeholder appears multiple times', () => {
      const code = `${FUNCTIONS_PLACEHOLDER}\nsome code\n${FUNCTIONS_PLACEHOLDER}`;

      expect(containsFunctionsPlaceholder(code)).toBe(true);
    });
  });

  describe('getFunctionsSourcePath', () => {
    it('returns dist/scripts/functions.js', () => {
      const result = getFunctionsSourcePath();

      expect(result).toMatch(/dist\/scripts\/functions\.js$/);
    });

    it('returns a forward-slash-normalized path', () => {
      const result = getFunctionsSourcePath();

      expect(result).not.toContain('\\');
    });

    it('returns a consistent path on repeated calls', () => {
      expect(getFunctionsSourcePath()).toBe(getFunctionsSourcePath());
    });
  });

  describe('loadFunctionsSource', () => {
    it('reads from the provided source path using injected readFileSync', () => {
      const mockReadFileSync = vi.fn().mockReturnValue('function source code');
      const deps: InjectFunctionsDependencies = { readFileSync: mockReadFileSync };

      const result = loadFunctionsSource('/custom/path/functions.ts', deps);

      expect(result).toBe('function source code');
      expect(mockReadFileSync).toHaveBeenCalledWith('/custom/path/functions.ts', 'utf8');
    });

    it('falls back to getFunctionsSourcePath() when no sourcePath is provided', () => {
      const mockReadFileSync = vi.fn().mockReturnValue('default source');
      const deps: InjectFunctionsDependencies = { readFileSync: mockReadFileSync };

      const result = loadFunctionsSource(undefined, deps);

      expect(result).toBe('default source');
      expect(mockReadFileSync).toHaveBeenCalledWith(getFunctionsSourcePath(), 'utf8');
    });

    it('passes "utf8" encoding to readFileSync', () => {
      const mockReadFileSync = vi.fn().mockReturnValue('');
      const deps: InjectFunctionsDependencies = { readFileSync: mockReadFileSync };

      loadFunctionsSource('/any/path.ts', deps);

      expect(mockReadFileSync).toHaveBeenCalledWith('/any/path.ts', 'utf8');
    });

    it('falls back to src/scripts/functions.ts when dist/scripts/functions.js has not been built yet', () => {
      const source = loadFunctionsSource('/nonexistent/dist/scripts/functions.js');

      expect(source).toContain('getModifiers');
      expect(source).toContain('viteAbsoluteUrl');
      const existingSource = loadFunctionsSource(getFunctionsSourcePath().replace('dist/scripts/functions.js', 'src/scripts/functions.ts'));

      expect(existingSource).toBe(source);
    });
  });
});
