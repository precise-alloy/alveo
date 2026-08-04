// @vitest-environment node

import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
  aggregateStates,
  buildStatesOnce,
  defaultStatesCoreDependencies,
  runStatesCoreBuild,
  StatesCoreDependencies,
  watchStates,
  writeStates,
} from './states-core.ts';

const createMockWatcher = () => ({
  on: vi.fn().mockReturnThis(),
});

const createDependencies = (overrides: Partial<StatesCoreDependencies> = {}): StatesCoreDependencies => ({
  existsSync: vi.fn().mockReturnValue(true) as never,
  mkdirSync: vi.fn() as never,
  readFileSync: vi.fn().mockReturnValue('{"state":true}') as never,
  writeFileSync: vi.fn() as never,
  globSync: vi.fn().mockReturnValue([]) as never,
  createWatcher: vi.fn().mockReturnValue(createMockWatcher()) as never,
  createDebounce: vi.fn((callback: () => void) => callback) as never,
  log: vi.fn() as never,
  ...overrides,
});

describe('alveo/states-core.ts', () => {
  it('exposes a default debounce dependency', () => {
    const debounced = defaultStatesCoreDependencies.createDebounce(vi.fn(), 500);

    expect(typeof debounced).toBe('function');
  });

  describe('aggregateStates', () => {
    it('sorts state keys before parsing output', () => {
      const deps = createDependencies();

      const result = aggregateStates(
        {
          '/project/src/z.states.json': '{"name":"z"}',
          '/project/src/a.states.json': '{"name":"a"}',
        },
        deps
      );

      expect(result).toEqual({ output: [{ name: 'a' }, { name: 'z' }], errors: [] });
    });

    it('skips empty state entries', () => {
      const deps = createDependencies();

      const result = aggregateStates({ '/project/src/a.states.json': undefined }, deps);

      expect(result).toEqual({ output: [], errors: [] });
    });

    it('logs malformed JSON and returns parse errors', () => {
      const deps = createDependencies();

      const result = aggregateStates({ '/project/src/bad.states.json': '{bad json}' }, deps);

      expect(result.output).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.filePath).toBe('/project/src/bad.states.json');
      expect(deps.log).toHaveBeenCalledWith(result.errors[0]?.error);
    });
  });

  describe('writeStates', () => {
    it('writes formatted JSON to the output path', () => {
      const writeFileSync = vi.fn();
      const deps = createDependencies({ writeFileSync: writeFileSync as never });

      writeStates([{ name: 'state' }], '/project/public/pl-states.json', deps);

      expect(writeFileSync).toHaveBeenCalledWith('/project/public/pl-states.json', JSON.stringify([{ name: 'state' }], null, '  '));
    });

    it('creates the output directory when it does not exist', () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const mkdirSync = vi.fn();
      const deps = createDependencies({ existsSync: existsSync as never, mkdirSync: mkdirSync as never });

      writeStates([], '/project/public/pl-states.json', deps);

      expect(mkdirSync).toHaveBeenCalledWith('/project/public', { recursive: true });
    });

    it('does not create the output directory when it already exists', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const mkdirSync = vi.fn();
      const deps = createDependencies({ existsSync: existsSync as never, mkdirSync: mkdirSync as never });

      writeStates([], '/project/public/pl-states.json', deps);

      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('buildStatesOnce', () => {
    it('writes an empty array when no state files are found', () => {
      const writeFileSync = vi.fn();
      const deps = createDependencies({ globSync: vi.fn().mockReturnValue([]) as never, writeFileSync: writeFileSync as never });

      const result = buildStatesOnce('/project', deps);

      expect(result).toEqual({ ok: true, errors: [] });
      expect(writeFileSync).toHaveBeenCalledWith(path.resolve('/project', 'public/pl-states.json'), '[]');
    });

    it('reads discovered state files and writes before returning success', () => {
      const writeFileSync = vi.fn();
      const deps = createDependencies({
        globSync: vi.fn().mockReturnValue(['/project/src/state.states.json']) as never,
        readFileSync: vi.fn().mockReturnValue('{"ready":true}') as never,
        writeFileSync: writeFileSync as never,
      });

      const result = buildStatesOnce('/project', deps);

      expect(result).toEqual({ ok: true, errors: [] });
      expect(writeFileSync).toHaveBeenCalledWith(path.resolve('/project', 'public/pl-states.json'), JSON.stringify([{ ready: true }], null, '  '));
    });

    it('returns a failure result and does not write partial output when parsing fails', () => {
      const errorInputPath = '/project/src/bad.states.json';
      const writeFileSync = vi.fn();
      const deps = createDependencies({
        globSync: vi.fn().mockReturnValue(['/project/src/good.states.json', errorInputPath]) as never,
        readFileSync: vi.fn((inputPath: string) => (inputPath === errorInputPath ? '{bad json}' : '{"ok":true}')) as never,
        writeFileSync: writeFileSync as never,
      });

      const result = buildStatesOnce('/project', deps);

      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.filePath).toBe(errorInputPath);
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('watchStates', () => {
    it('creates a watcher and registers ready, add, change, and unlink handlers', () => {
      const watcher = createMockWatcher();
      const createWatcher = vi.fn().mockReturnValue(watcher);
      const deps = createDependencies({ createWatcher: createWatcher as never });

      const result = watchStates('/project', deps);

      expect(result).toBe(watcher);
      expect(createWatcher).toHaveBeenCalledWith(expect.stringContaining('src/**/*.states.json'));
      expect(watcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(watcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(watcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(watcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('uses a 500 ms debounce for watch builds and keeps log-and-continue output', () => {
      const callbacks: Record<string, (statePath: string) => void> = {};
      const watcher = {
        on: vi.fn().mockImplementation((eventName: string, callback: (statePath: string) => void) => {
          callbacks[eventName] = callback;

          return watcher;
        }),
      };
      const scheduledBuild = vi.fn();
      let latestBuild: (() => void) | undefined;
      const createDebounce = vi.fn((callback: () => void, wait: number) => {
        latestBuild = callback;
        expect(wait).toBe(500);

        return scheduledBuild;
      });
      const writeFileSync = vi.fn();
      const deps = createDependencies({
        globSync: vi.fn().mockReturnValue(['/project/src/initial.states.json']) as never,
        createWatcher: vi.fn().mockReturnValue(watcher) as never,
        createDebounce: createDebounce as never,
        readFileSync: vi.fn((inputPath: string) => (inputPath.includes('bad') ? '{bad json}' : '{"file":"' + inputPath + '"}')) as never,
        writeFileSync: writeFileSync as never,
      });

      watchStates('/project', deps);
      callbacks['ready']?.('');
      callbacks['add']?.('src/added.states.json');
      callbacks['change']?.('/project/src/bad.states.json');
      callbacks['unlink']?.('/project/src/initial.states.json');
      latestBuild?.();

      expect(deps.log).toHaveBeenCalledWith('States are ready!');
      expect(scheduledBuild).toHaveBeenCalledTimes(4);
      expect(deps.log).toHaveBeenCalledWith(expect.any(SyntaxError));
      expect(writeFileSync).toHaveBeenCalledWith(path.resolve('/project', 'public/pl-states.json'), expect.stringContaining('src/added.states.json'));
    });
  });

  describe('runStatesCoreBuild', () => {
    it('runs the one-shot build when watch mode is disabled', () => {
      const deps = createDependencies({ globSync: vi.fn().mockReturnValue([]) as never });

      const result = runStatesCoreBuild({ projectRoot: '/project' }, deps);

      expect(result).toEqual({ ok: true, errors: [] });
    });

    it('runs the watcher when watch mode is enabled', () => {
      const watcher = createMockWatcher();
      const deps = createDependencies({ createWatcher: vi.fn().mockReturnValue(watcher) as never });

      const result = runStatesCoreBuild({ projectRoot: '/project', isWatch: true }, deps);

      expect(result).toBe(watcher);
    });
  });
});
