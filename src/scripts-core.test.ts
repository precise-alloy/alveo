// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compileScript,
  compileDiscoveredScripts,
  defaultScriptCoreDependencies,
  getScriptBuildOptions,
  getScriptOutputPath,
  runScriptBuild,
  watchScripts,
  type ScriptCoreDependencies,
} from './scripts-core.ts';

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-scripts-'));

  roots.push(root);
  fs.mkdirSync(path.join(root, 'src/assets/scripts'), { recursive: true });

  return root;
}
const write = (root: string, file: string, content: string) => {
  const target = path.join(root, file);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);

  return target;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('script entry bundles', () => {
  it('bundles imported helpers, ignores tests/nonentries, and writes linked LF sourcemaps', async () => {
    const root = fixture();

    write(root, 'src/assets/scripts/main.entry.ts', "import { answer } from './helper';\r\nglobalThis.answer = answer(41);\r\n");
    write(root, 'src/assets/scripts/helper.ts', 'export const answer = (value: number) => value + 1;\r\n');
    write(root, 'src/assets/scripts/api.test.ts', 'this is not valid source');
    write(root, 'src/assets/scripts/__tests__/bad.entry.ts', 'this is not valid source');
    const result = await runScriptBuild(root, []);

    expect(result).toMatchObject({ ok: true, errors: [] });
    const code = fs.readFileSync(path.join(root, 'public/assets/js/main.js'), 'utf8');
    const context: Record<string, unknown> = {};

    new Script(code).runInNewContext(context);
    expect(context.answer).toBe(42);
    expect(code).toContain('sourceMappingURL=main.js.map');
    expect(code).not.toContain('import ');
    const mapText = fs.readFileSync(path.join(root, 'public/assets/js/main.js.map'), 'utf8');

    expect(mapText).not.toContain('\\r');
    expect(JSON.parse(mapText).sourcesContent).toContain('export const answer = (value: number) => value + 1;\n');
    expect(fs.readdirSync(path.join(root, 'public/assets/js')).sort()).toEqual(['main.js', 'main.js.map']);
  });

  it.each(['js', 'jsx', 'ts', 'tsx'])('bundles %s entries', async (ext) => {
    const root = fixture();
    const input = write(root, `src/assets/scripts/view.entry.${ext}`, 'globalThis.ready = true;');

    expect((await compileScript(input, root)).ok).toBe(true);
  });

  it('compiles JSX and preserves ESM exports', async () => {
    const root = fixture();
    const input = write(root, 'src/assets/scripts/view.entry.tsx', 'export const View = () => <div />;');
    const build = vi.fn().mockImplementation((options) => defaultScriptCoreDependencies.build({ ...options, external: ['react/jsx-runtime'] }));

    expect((await compileScript(input, root, { ...defaultScriptCoreDependencies, build })).ok).toBe(true);
    expect(fs.readFileSync(getScriptOutputPath(input, root), 'utf8')).toContain('export');
  });

  it('keeps critical entry scripts free of sourcemap requests', async () => {
    const root = fixture();
    const input = write(root, 'src/assets/scripts/theme-critical.entry.ts', 'globalThis.ready = true;');

    expect((await compileScript(input, root)).ok).toBe(true);
    expect(fs.readFileSync(getScriptOutputPath(input, root), 'utf8')).not.toContain('sourceMappingURL');
    expect(fs.existsSync(getScriptOutputPath(input, root) + '.map')).toBe(false);
    expect(getScriptBuildOptions(input, root)).toMatchObject({ minify: true, format: 'esm', bundle: true, sourcemap: false });
  });

  it('uses the same normalized entry names as Vite', () => {
    expect(getScriptOutputPath('/src/MyEntry.entry.ts', '/project')).toBe(path.resolve('/project/public/assets/js/my-entry.js'));
    expect(() => getScriptOutputPath('/src/helper.ts', '/project')).toThrow('Script entry');
    expect(() => getScriptOutputPath('/src/.entry.ts', '/project')).toThrow('Script entry');
  });

  it('reports compiler, incomplete-output, and write failures', async () => {
    const log = vi.fn();

    for (const build of [
      vi.fn().mockRejectedValue(new Error('compile')),
      vi.fn().mockResolvedValue({}),
      vi.fn().mockResolvedValue({ outputFiles: [] }),
    ]) {
      expect((await compileScript('/src/main.entry.ts', '/project', { ...defaultScriptCoreDependencies, build, log })).ok).toBe(false);
    }
    const root = fixture();
    const input = write(root, 'src/assets/scripts/main.entry.ts', 'console.log(1)');
    const writeFileSync = vi.fn(() => {
      throw new Error('disk full');
    });

    expect((await compileScript(input, root, { ...defaultScriptCoreDependencies, writeFileSync, log })).errors[0]?.error).toEqual(
      new Error('disk full')
    );
    expect(log).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rejects colliding entry names before writing and reports discovery errors', async () => {
    const log = vi.fn();
    const build = vi.fn();
    const dependencies = {
      ...defaultScriptCoreDependencies,
      log,
      build,
      globSync: vi.fn().mockReturnValue(['/src/a/main.entry.ts', '/src/b/main.entry.ts']),
    };

    expect((await compileDiscoveredScripts('/project', dependencies)).ok).toBe(false);
    expect(build).not.toHaveBeenCalled();
    dependencies.globSync.mockImplementation(() => {
      throw new Error('read failed');
    });
    expect((await compileDiscoveredScripts('/project', dependencies)).errors[0]?.error).toEqual(new Error('read failed'));
  });

  it('aggregates failed entries and handles empty discovery/default argv', async () => {
    const root = fixture();

    expect(await runScriptBuild(root)).toEqual({ ok: true, errors: [], inputs: [] });
    write(root, 'src/assets/scripts/bad.entry.ts', 'not valid }');
    expect((await compileDiscoveredScripts(root)).ok).toBe(false);
  });

  it('watches real directories and imported files, serializes rebuilds and cleans deleted outputs', async () => {
    vi.useFakeTimers();
    const root = fixture();
    const input = write(root, 'src/assets/scripts/main.entry.ts', "import '../../../external';");

    write(root, 'external.ts', 'globalThis.answer = 42;');
    const emitter = Object.assign(new EventEmitter(), { add: vi.fn(), close: vi.fn().mockResolvedValue(undefined) });
    const originalClose = emitter.close;
    const dependencies: ScriptCoreDependencies = {
      ...defaultScriptCoreDependencies,
      createWatcher: vi.fn().mockReturnValue(emitter),
      rmSync: vi.fn(),
      log: vi.fn(),
    };
    const watcher = await runScriptBuild(root, ['--watch'], dependencies);

    expect(watcher).toBe(emitter);
    expect(dependencies.createWatcher).toHaveBeenCalledWith(path.join(root, 'src'), { ignoreInitial: true });
    expect(emitter.add).toHaveBeenCalledWith(expect.arrayContaining([path.join(root, 'external.ts')]));
    emitter.emit('all', 'change', path.join(root, 'external.ts'));
    await vi.advanceTimersByTimeAsync(100);
    emitter.emit('error', new Error('watch failed'));
    expect(dependencies.log).toHaveBeenCalledWith(new Error('watch failed'));
    emitter.emit('all', 'unlink', input);
    expect(dependencies.rmSync).toHaveBeenCalledTimes(4);
    emitter.emit('all', 'unlink', path.join(root, 'external.ts'));
    await emitter.close();
    expect(originalClose).toHaveBeenCalledOnce();
  });

  it('starts and closes the default watcher', async () => {
    const root = fixture();
    const watcher = await watchScripts(root);

    await watcher.close();
  });
});
