// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SourceMapConsumer } from 'source-map-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runStyleBuild } from './styles.ts';

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));

vi.mock('chokidar', () => ({ watch }));
const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-styles-'));

  roots.push(root);
  const files = {
    'src/assets/styles/00-abstracts/_abstracts.scss': '$tone: #123456;\r\n',
    'src/assets/styles/01-functions/_functions.scss': '',
    'src/assets/styles/01-mixins/_mixins.scss': "@forward 'tone';\r\n",
    'src/assets/styles/01-mixins/_tone.scss': '@mixin tone { color: $tone; }\r\n',
    'src/assets/styles/style-base.scss': '.base { color: blue; }\r\n',
    'src/atoms/button.scss': '.atom { @include tone; padding: 1px; }\r\n',
    'src/molecules/card.scss': '.molecule { margin: 2px; }\r\n',
  };

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  return root;
};

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('stylesheet orchestration', () => {
  it('preserves base/atom/molecule cascade and real source identities, compiling framework entries once', async () => {
    const root = fixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runStyleBuild({ projectRoot: root });
    const css = fs.readFileSync(path.join(root, 'public/assets/css/style-base.css'), 'utf8');

    expect(css.indexOf('.base')).toBeLessThan(css.indexOf('.atom'));
    expect(css.indexOf('.atom')).toBeLessThan(css.indexOf('.molecule'));
    const map = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/css/style-base.css.map'), 'utf8'));

    expect(map.sources.join('\n')).toContain('src/atoms/button.scss');
    expect(map.sourcesContent).toContain('.atom { @include tone; padding: 1px; }\n');
    expect(map.sources).toContain('src/assets/styles/01-mixins/_tone.scss');
    expect(map.sourcesContent).toContain('.base { color: blue; }\n');
    const original = new SourceMapConsumer(map).originalPositionFor({ line: 1, column: css.indexOf('padding:1px') });

    expect(original.source, JSON.stringify({ css, mappings: map.mappings, sources: map.sources })).toBe('src/atoms/button.scss');
    expect(original.line).toBe(1);
    const stateCss = fs.readFileSync(path.join(root, 'public/assets/css/pl-states.css'), 'utf8');

    expect(stateCss).toContain('@media print{.pl-state,.pl-state-bar{display:none!important}}');
    expect(
      log.mock.calls
        .filter(([message]) => message === 'compile:')
        .map(([, file]) => path.basename(String(file)))
        .sort()
    ).toEqual(['pl-states.scss', 'root.scss', 'style-base.scss']);
  });

  it('rejects a one-shot build on Sass failure rather than only setting an exit code', async () => {
    const root = fixture();

    fs.writeFileSync(path.join(root, 'src/atoms/button.scss'), '.broken {');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runStyleBuild({ projectRoot: root })).rejects.toThrow('Styles build failed');
    expect(error).toHaveBeenCalled();
  });

  it('uses one initial watch scan and coalesces subsequent source changes', async () => {
    vi.useFakeTimers();
    const root = fixture();
    const watcher = { on: vi.fn().mockReturnThis() };

    watch.mockReturnValue(watcher);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await runStyleBuild({ projectRoot: root, isWatch: true })).toBe(watcher);
    expect(watch).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ ignoreInitial: true }));
    const ready = watcher.on.mock.calls.find(([event]) => event === 'ready')![1];

    await ready();
    expect(log.mock.calls.filter(([message]) => message === 'compile:')).toHaveLength(3);
    const change = watcher.on.mock.calls.find(([event]) => event === 'change')![1];

    change(path.join(root, 'src/assets/styles/style-base.scss'));
    change(path.join(root, 'src/atoms/button.scss'));
    await vi.advanceTimersByTimeAsync(200);
    expect(log.mock.calls.filter(([message]) => message === 'compile:')).toHaveLength(4);
    change(path.join(root, 'src/assets/styles/00-abstracts/_abstracts.scss'));
    change(path.join(root, 'src/assets/styles/01-functions/_functions.scss'));
    change(path.join(root, 'src/assets/styles/01-mixins/_tone.scss'));
    await vi.advanceTimersByTimeAsync(200);
    expect(log.mock.calls.filter(([message]) => message === 'compile:')).toHaveLength(6);
  });
});
