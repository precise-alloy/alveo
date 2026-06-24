// @vitest-environment node

import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
  getScriptTransformOptions,
  getScriptOutputPath,
  compileScript,
  watchScripts,
  compileDiscoveredScripts,
  runScriptBuild,
  ScriptCoreDependencies,
} from './scripts-core.js';

const buildDeps = (overrides: Partial<ScriptCoreDependencies> = {}): ScriptCoreDependencies => ({
  existsSync: vi.fn().mockReturnValue(true) as never,
  mkdirSync: vi.fn() as never,
  readFileSync: vi.fn().mockReturnValue('const x = 1;') as never,
  writeFileSync: vi.fn() as never,
  transformWithEsbuild: vi.fn().mockResolvedValue({ code: 'var x=1;', map: null }) as never,
  globSync: vi.fn().mockReturnValue([]) as never,
  createWatcher: vi.fn() as never,
  log: vi.fn() as never,
  ...overrides,
});

describe('alveo/scripts-core.ts', () => {
  describe('getScriptTransformOptions', () => {
    it('returns minify: true', () => {
      const options = getScriptTransformOptions('/any/file.ts');

      expect(options.minify).toBe(true);
    });

    it('returns format: "esm"', () => {
      const options = getScriptTransformOptions('/any/file.ts');

      expect(options.format).toBe('esm');
    });

    it('returns sourcemap: "external" for non-critical files', () => {
      const options = getScriptTransformOptions('/src/scripts/app.ts');

      expect(options.sourcemap).toBe('external');
    });

    it('returns sourcemap: false for critical files', () => {
      const options = getScriptTransformOptions('/src/scripts/critical.ts');

      expect(options.sourcemap).toBe(false);
    });

    it('detects "critical" anywhere in the basename', () => {
      const options = getScriptTransformOptions('/src/scripts/my-critical-script.ts');

      expect(options.sourcemap).toBe(false);
    });
  });

  describe('getScriptOutputPath', () => {
    it('resolves output path under public/assets/js/ with .js extension', () => {
      const result = getScriptOutputPath('/project/src/assets/scripts/app.ts', '/project');
      const expected = path.resolve('/project', 'public/assets/js/app.js');

      expect(result).toBe(expected);
    });

    it('strips the original extension and uses .js', () => {
      const result = getScriptOutputPath('/project/src/scripts/widget.tsx', '/project');
      const expected = path.resolve('/project', 'public/assets/js/widget.js');

      expect(result).toBe(expected);
    });

    it('uses the basename (no directory nesting) in the output', () => {
      const result = getScriptOutputPath('/project/src/assets/scripts/nested/deep/file.ts', '/project');
      const expected = path.resolve('/project', 'public/assets/js/file.js');

      expect(result).toBe(expected);
    });
  });

  describe('compileScript', () => {
    it('reads the input file, transforms it, and writes the output', async () => {
      const writeFileSync = vi.fn();
      const transformWithEsbuild = vi.fn().mockResolvedValue({ code: 'compiled;', map: null });
      const deps = buildDeps({ writeFileSync, transformWithEsbuild });

      await compileScript('/project/src/scripts/app.ts', '/project', deps);

      expect(deps.readFileSync).toHaveBeenCalledWith('/project/src/scripts/app.ts', 'utf8');
      expect(transformWithEsbuild).toHaveBeenCalledWith('const x = 1;', '/project/src/scripts/app.ts', expect.objectContaining({ minify: true }));
      expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('app.js'), 'compiled;');
    });

    it('creates the output directory if it does not exist', async () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const mkdirSync = vi.fn();
      const deps = buildDeps({ existsSync, mkdirSync });

      await compileScript('/project/src/scripts/app.ts', '/project', deps);

      expect(mkdirSync).toHaveBeenCalled();
    });

    it('does not create the output directory if it already exists', async () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const mkdirSync = vi.fn();
      const deps = buildDeps({ existsSync, mkdirSync });

      await compileScript('/project/src/scripts/app.ts', '/project', deps);

      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it('logs the compile path on start', async () => {
      const log = vi.fn();
      const deps = buildDeps({ log });

      await compileScript('/project/src/scripts/app.ts', '/project', deps);

      expect(log).toHaveBeenCalledWith('compile:', expect.stringContaining('app.ts'));
    });

    it('logs errors when transform fails instead of throwing', async () => {
      const log = vi.fn();
      const error = new Error('transform failed');
      const transformWithEsbuild = vi.fn().mockRejectedValue(error);
      const deps = buildDeps({ log, transformWithEsbuild });

      await compileScript('/project/src/scripts/app.ts', '/project', deps);

      expect(log).toHaveBeenCalledWith(error);
    });
  });

  describe('watchScripts', () => {
    it('creates a watcher with the correct glob pattern', () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const deps = buildDeps({ createWatcher });

      watchScripts('/project', deps);

      expect(createWatcher).toHaveBeenCalledWith(expect.stringContaining('src/assets/scripts/**/*.{js,jsx,ts,tsx}'));
    });

    it('registers add, change, and unlink event handlers', () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const deps = buildDeps({ createWatcher });

      watchScripts('/project', deps);

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('returns the watcher instance', () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const deps = buildDeps({ createWatcher });

      const result = watchScripts('/project', deps);

      expect(result).toBe(mockWatcher);
    });

    it('add callback compiles the script', async () => {
      const callbacks: Record<string, (inputPath: string) => unknown> = {};
      const mockWatcher = {
        on: vi.fn().mockImplementation((event: string, cb: (inputPath: string) => unknown) => {
          callbacks[event] = cb;

          return mockWatcher;
        }),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const transformWithEsbuild = vi.fn().mockResolvedValue({ code: 'compiled;', map: null });
      const deps = buildDeps({ createWatcher, transformWithEsbuild });

      watchScripts('/project', deps);
      await callbacks['add']!('/project/src/assets/scripts/app.ts');

      expect(transformWithEsbuild).toHaveBeenCalled();
    });

    it('change callback compiles the script', async () => {
      const callbacks: Record<string, (inputPath: string) => unknown> = {};
      const mockWatcher = {
        on: vi.fn().mockImplementation((event: string, cb: (inputPath: string) => unknown) => {
          callbacks[event] = cb;

          return mockWatcher;
        }),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const transformWithEsbuild = vi.fn().mockResolvedValue({ code: 'compiled;', map: null });
      const deps = buildDeps({ createWatcher, transformWithEsbuild });

      watchScripts('/project', deps);
      await callbacks['change']!('/project/src/assets/scripts/app.ts');

      expect(transformWithEsbuild).toHaveBeenCalled();
    });

    it('unlink callback logs that the file has been removed', () => {
      const callbacks: Record<string, (inputPath: string) => unknown> = {};
      const mockWatcher = {
        on: vi.fn().mockImplementation((event: string, cb: (inputPath: string) => unknown) => {
          callbacks[event] = cb;

          return mockWatcher;
        }),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const log = vi.fn();
      const deps = buildDeps({ createWatcher, log });

      watchScripts('/project', deps);
      callbacks['unlink']!('/project/src/assets/scripts/removed.ts');

      expect(log).toHaveBeenCalledWith('File /project/src/assets/scripts/removed.ts has been removed');
    });
  });

  describe('compileDiscoveredScripts', () => {
    it('globs for script files and compiles each one', async () => {
      const globSync = vi.fn().mockReturnValue(['/project/src/assets/scripts/a.ts', '/project/src/assets/scripts/b.ts']);
      const transformWithEsbuild = vi.fn().mockResolvedValue({ code: 'compiled;', map: null });
      const deps = buildDeps({ globSync, transformWithEsbuild });

      await compileDiscoveredScripts('/project', deps);

      expect(globSync).toHaveBeenCalledWith(expect.stringContaining('src/assets/scripts/**/*.{js,jsx,ts,tsx}'));
      expect(transformWithEsbuild).toHaveBeenCalledTimes(2);
    });

    it('handles empty glob result', async () => {
      const globSync = vi.fn().mockReturnValue([]);
      const transformWithEsbuild = vi.fn();
      const deps = buildDeps({ globSync, transformWithEsbuild });

      await compileDiscoveredScripts('/project', deps);

      expect(transformWithEsbuild).not.toHaveBeenCalled();
    });
  });

  describe('runScriptBuild', () => {
    it('calls watchScripts when --watch is in argv', async () => {
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
      };
      const createWatcher = vi.fn().mockReturnValue(mockWatcher);
      const deps = buildDeps({ createWatcher });

      const result = await runScriptBuild('/project', ['node', 'script', '--watch'], deps);

      expect(createWatcher).toHaveBeenCalled();
      expect(result).toBe(mockWatcher);
    });

    it('calls compileDiscoveredScripts when --watch is not in argv', async () => {
      const globSync = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ globSync });

      await runScriptBuild('/project', ['node', 'script'], deps);

      expect(globSync).toHaveBeenCalled();
    });
  });
});
