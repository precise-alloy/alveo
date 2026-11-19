// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
  it('versions public image/font URLs from consumer bytes and picks up changed assets on the next compilation', async () => {
    const root = fixture();
    const assets = path.join(root, 'public/assets');
    const svg = '<svg>\n</svg>\n';
    const font = Buffer.from([255, 13, 10, 0]);
    const version = (bytes: string | Buffer) => createHash('sha384').update(bytes).digest('base64url').slice(0, 10);
    const readCss = () => fs.readFileSync(path.join(assets, 'css/style-base.css'), 'utf8');

    fs.mkdirSync(path.join(assets, 'images'), { recursive: true });
    fs.mkdirSync(path.join(assets, 'fonts'));
    fs.writeFileSync(path.join(assets, 'images/icon.svg'), svg.replaceAll('\n', '\r\n'));
    fs.writeFileSync(path.join(assets, 'images/logo@2x.png'), font);
    fs.writeFileSync(path.join(assets, 'fonts/probe.woff2'), font);
    fs.writeFileSync(
      path.join(root, 'src/assets/styles/style-base.scss'),
      [
        '@font-face { font-family: probe; src: url(/assets/fonts/probe.woff2) }',
        '.a { background: url(/assets/images/icon.svg#dot) }',
        '.b { background: url(/assets/images/icon.svg?v=2) }',
        '.c { background: url(https://example.test/assets/images/icon.svg) }',
        '.d::after { content: "/assets/images/icon.svg" }',
        '.e { background: url("/assets/images/logo@2x.png") }',
      ].join('\n')
    );

    await runStyleBuild({ projectRoot: root });
    const css = readCss();

    expect(css).toContain(`/assets/images/icon.svg?v=${version(svg)}#dot`);
    expect(css).toContain(`/assets/fonts/probe.woff2?v=${version(font)}`);
    expect(css).toContain(`/assets/images/logo@2x.png?v=${version(font)}`);
    expect(css).toMatch(/\/assets\/images\/icon\.svg\?v=2["']?\)/);
    expect(css).toMatch(/https:\/\/example\.test\/assets\/images\/icon\.svg["']?\)/);
    expect(css).toContain('"/assets/images/icon.svg"');

    const changed = Buffer.from([255, 10, 0]);

    fs.writeFileSync(path.join(assets, 'fonts/probe.woff2'), changed);
    await runStyleBuild({ projectRoot: root });
    expect(readCss()).toContain(`/assets/fonts/probe.woff2?v=${version(changed)}`);
    expect(readCss()).not.toContain(`/assets/fonts/probe.woff2?v=${version(font)}`);
  });

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
