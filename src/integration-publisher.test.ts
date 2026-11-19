// @vitest-environment node

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withCheckedFile } from './checked-file.ts';
import { runIntegration } from './integration.ts';
import { hashFileContent } from './prerender-core.ts';

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (root: string, file: string, bytes: string | Buffer) => {
  const target = path.join(root, file);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};
const fixtures: string[] = [];
const loader = 'react-loader.0xAbCdEf12.js';
const fixture = () => {
  const root = path.resolve('test/temp', 'publish-' + randomUUID());

  fixtures.push(root);
  const project = path.join(root, 'project');
  const build = path.join(project, 'dist/static');
  const source = path.join(build, 'assets');
  const assets = path.join(root, 'assets');
  const patterns = path.join(root, 'patterns');

  vi.stubEnv('VITE_INTE_ASSET_DIR', assets);
  vi.stubEnv('VITE_INTE_PATTERN_DIR', patterns);
  write(source, 'js/main.js', 'old();\r\n');
  write(source, 'js/' + loader, 'import "./rolldown-runtime.0xaaaaaaaa.js";');
  write(build, 'pages/home.html', `<script src="/assets/js/${loader}"></script>\r\n`);
  const publish = () => runIntegration({ projectRoot: project, argv: [] });

  return { root, project, build, source, assets, patterns, publish };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of fixtures.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

// Include link targets and inode timestamps: refusal must not even rewrite
// unchanged bytes or create a missing sibling destination.
const snapshot = (root: string): unknown => {
  const stat = fs.lstatSync(root, { bigint: true, throwIfNoEntry: false });

  if (!stat) return null;
  if (stat.isSymbolicLink()) return ['link', fs.readlinkSync(root)];
  if (stat.isDirectory()) return Object.fromEntries(fs.readdirSync(root).map((name) => [name, snapshot(path.join(root, name))]));

  return [stat.ino, stat.mtimeNs, withCheckedFile(root, stat, 'read', (fd) => fs.readFileSync(fd))];
};

describe('integration publisher', () => {
  it('replaces populated legacy destinations without needing, trusting, or creating a record', () => {
    const f = fixture();

    write(f.assets, 'js', 'a file where the build needs a directory');
    write(f.patterns, 'pages-home.html/.gitkeep', 'a directory where the build needs a file');
    write(f.assets, '.alveo-integration.json', '{');
    write(f.patterns, '.alveo-integration.json', '{"files":["../outside.txt"]}');
    write(f.root, 'outside.txt', 'untouched');
    expect(f.publish().isValid).toBe(true);
    expect(read(f.assets, 'js/main.js')).toBe('old();\n');
    expect(read(f.patterns, 'pages-home.html')).toContain('react-loader');
    expect(read(f.root, 'outside.txt')).toBe('untouched');
    for (const root of [f.assets, f.patterns]) expect(fs.existsSync(path.join(root, '.alveo-integration.json'))).toBe(false);
  });

  it('keeps the existing asset/hash/pattern formats and removes everything absent from the next build', () => {
    const f = fixture();

    fs.mkdirSync(f.assets);
    fs.mkdirSync(f.patterns);
    const binary = Buffer.concat([Buffer.alloc(5000, 32), Buffer.from([0, 0xff, 13, 10])]);

    write(f.source, 'movie.0xaaaa.mp4', binary);
    const ppm = Buffer.from('P6\n1 1\n255\n\r\nA');

    write(f.source, 'pixel.ppm', ppm);
    write(f.source, 'pages/pixel.ppm', ppm);
    write(f.source, 'misc/.nested/old', 'old\r\n');
    write(f.source, 'css/site.css', 'p{}\r\n');
    write(f.source, 'css/.hidden.css', '/* private */\r\n');
    write(f.source, 'js/main.js.map', JSON.stringify({ sourcesContent: ['original\r\n'] }));
    write(f.source, 'pages/deep/alt.htm', '<img src="logo.svg?v=old">\r\n');
    write(f.source, 'pages/data.csv', 'x,y\r\n');
    write(f.source, 'pages/sample.cshtml', '@model Page\r\n<img src="logo.svg?v=keep">\r\n');
    write(f.source, 'hashes.json', 'not the generated manifest');
    const preload = '<link rel="modulepreload" href="/assets/js/rolldown-runtime.0xaaaaaaaa.js">\r\n';

    write(f.build, 'atoms/a/help.html', preload + '<p>help</p>\r\n');
    write(f.build, 'atoms/.draft/hidden.html', 'ignored');
    write(f.build, 'atoms/extensionless', 'ignored');

    expect(f.publish()).toEqual({ isValid: true, missing: [] });
    expect(JSON.parse(read(f.assets, 'hashes.json'))).toEqual({
      '/assets/css/site.css': hashFileContent('p{}\n'),
      '/assets/js/main.js': hashFileContent('old();\n'),
      ['/assets/js/' + loader]: '',
    });
    expect(fs.readFileSync(path.join(f.assets, 'movie.0xaaaa.mp4'))).toEqual(binary);
    expect(read(f.assets, 'misc/.nested/old')).toBe('old\n');
    expect(JSON.parse(read(f.assets, 'js/main.js.map')).sourcesContent).toEqual(['original\n']);
    expect(read(f.patterns, 'atoms-a-help.html')).toBe('<p>help</p>\n');
    expect(read(f.build, 'atoms/a/help.html')).toContain(preload);
    expect(read(f.patterns, 'pages-home.html')).toContain('react-loader.0x00000000.js');
    expect(read(f.patterns, 'deep/alt.htm')).toBe('<img src="logo.svg">\n');
    expect(read(f.patterns, 'data.csv')).toBe('x,y\n');
    expect(read(f.patterns, 'sample.cshtml')).toBe('@model Page\n<img src="logo.svg?v=keep">\n');
    for (const root of [f.assets, f.patterns]) expect(fs.readFileSync(path.join(root, 'pixel.ppm'))).toEqual(ppm);
    expect(fs.existsSync(path.join(f.assets, 'pages'))).toBe(false);
    write(f.assets, 'misc/.nested/manual.txt', 'private\r\n');
    write(f.assets, 'docs-reload.txt', '\r\n');
    write(f.patterns, 'deep/manual.html', '<img src="logo.svg?v=keep">\r\n');

    for (const name of ['misc/.nested/old', 'movie.0xaaaa.mp4', 'pages/deep/alt.htm']) fs.unlinkSync(path.join(f.source, name));
    fs.unlinkSync(path.join(f.build, 'atoms/a/help.html'));
    write(f.source, 'movie.0xbbbb.mp4', binary);
    expect(f.publish().isValid).toBe(true);
    for (const [dir, name] of [
      [f.assets, 'misc/.nested/old'],
      [f.assets, 'movie.0xaaaa.mp4'],
      [f.patterns, 'atoms-a-help.html'],
      [f.patterns, 'deep/alt.htm'],
      [f.assets, 'misc'],
      [f.assets, 'docs-reload.txt'],
      [f.patterns, 'deep'],
    ] as const) {
      expect(fs.existsSync(path.join(dir, name))).toBe(false);
    }
    expect(fs.readFileSync(path.join(f.assets, 'movie.0xbbbb.mp4'))).toEqual(binary);
  });

  it('publishes pages as assets when patterns are disabled and rejects unsafe root overrides', () => {
    const f = fixture();

    vi.stubEnv('VITE_INTE_PATTERN_DIR', undefined);
    vi.stubEnv('VITE_INTE_ASSET_DIR', undefined);
    expect(runIntegration({ projectRoot: f.project })).toEqual({ isValid: false, missing: ['VITE_INTE_ASSET_DIR is empty'] });
    expect(fs.existsSync(f.assets)).toBe(false);
    vi.stubEnv('VITE_INTE_ASSET_DIR', f.assets);
    vi.stubEnv('VITE_INTE_PATTERN_DIR', '');
    write(f.source, 'pages/deep/home.html', 'sample\r\n');
    expect(f.publish().isValid).toBe(true);
    expect(read(f.assets, 'pages/deep/home.html')).toBe('sample\n');
    expect(fs.existsSync(f.patterns)).toBe(false);
    vi.stubEnv('VITE_INTE_PATTERN_DIR', path.join(f.assets, 'inside'));
    expect(f.publish().isValid).toBe(false);
    expect(fs.existsSync(path.join(f.assets, 'inside'))).toBe(false);
  });

  it('validates new output, not stale or unrelated matches already at the destinations', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    write(f.patterns, 'manual.html', 'not a generated sample');
    write(f.assets, 'js/other-' + loader, 'not a generated loader');
    fs.unlinkSync(path.join(f.build, 'pages/home.html'));
    fs.unlinkSync(path.join(f.source, 'js', loader));
    fs.unlinkSync(path.join(f.source, 'js/main.js'));
    const before = [snapshot(f.assets), snapshot(f.patterns)];
    const { isValid, missing } = f.publish();

    expect(isValid).toBe(false);
    expect(missing.join()).toMatch(/No generated HTML patterns/);
    expect(missing.join()).toMatch(/main\.js/);
    expect(missing.join()).toMatch(/react-loader/);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
    write(f.build, 'pages/home.html', '');
    expect(f.publish).toThrow(/empty generated HTML pattern/i);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
  });

  it('refuses output overlapping the build through a linked dist directory', () => {
    const f = fixture();
    const external = path.join(f.root, 'build-output');

    fs.renameSync(path.join(f.project, 'dist'), external);
    fs.symlinkSync(external, path.join(f.project, 'dist'), 'junction');
    vi.stubEnv('VITE_INTE_PATTERN_DIR', path.join(external, 'static/pages'));
    expect(f.publish().isValid).toBe(false);
    expect(fs.existsSync(f.assets)).toBe(false);
    expect(read(f.build, 'pages/home.html')).toContain(loader);
  });

  it.each([
    ['atoms/a/b.html', 'assets/pages/atoms-a-b.html', /duplicate/i],
    ['atoms/a/b.html', 'atoms/a-b.html', /duplicate/i],
    ['pages/x.html', 'assets/pages/pages-x.html/child.html', /parent collision/i],
    ['atoms/a/B.html', 'atoms/a-b.html', /ambiguous/i],
  ] as const)('rejects ambiguous generated outputs: %s and %s', (first, second, reason) => {
    const f = fixture();

    write(f.build, first, 'one');
    write(f.build, second, 'two');
    expect(f.publish).toThrow(reason);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual([null, null]);
  });

  it('retains a validated root junction but removes child junctions without following them', () => {
    const f = fixture();
    const actual = path.join(f.root, 'actual');

    fs.mkdirSync(actual);
    fs.symlinkSync(actual, f.patterns, 'junction');
    write(f.source, 'pages/deep/sample.html', 'sample');
    expect(f.publish().isValid).toBe(true);
    write(f.project, 'sample.html', 'keep\r\n');
    fs.rmSync(path.join(actual, 'deep'), { recursive: true });
    fs.symlinkSync(f.project, path.join(actual, 'deep'), 'junction');
    fs.symlinkSync(path.join(f.root, 'absent'), path.join(f.assets, 'dangling'), 'junction');
    expect(f.publish().isValid).toBe(true);
    expect(fs.lstatSync(f.patterns).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(actual, 'deep')).isDirectory()).toBe(true);
    expect(read(actual, 'deep/sample.html')).toBe('sample');
    expect(read(f.project, 'sample.html')).toBe('keep\r\n');
    expect(fs.lstatSync(path.join(f.assets, 'dangling'), { throwIfNoEntry: false })).toBeUndefined();
    expect(fs.existsSync(path.join(f.root, 'absent'))).toBe(false);
  });

  it('rejects links in generated inputs before clearing destinations', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    const before = [snapshot(f.assets), snapshot(f.patterns)];

    fs.symlinkSync(f.project, path.join(f.source, 'source-link'), 'junction');
    expect(f.publish).toThrow(/regular build output/i);
    fs.unlinkSync(path.join(f.source, 'source-link'));
    fs.symlinkSync(f.project, path.join(f.build, 'atoms'), 'junction');
    expect(f.publish).toThrow(/expected build directory/i);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
  });

  it('does not truncate external hard links when replacing a file', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    fs.linkSync(path.join(f.assets, 'js/main.js'), path.join(f.project, 'keep.js'));
    write(f.source, 'js/main.js', 'new');
    write(f.source, 'other', 'new');
    expect(f.publish().isValid).toBe(true);
    expect(read(f.project, 'keep.js')).toBe('old();\n');
  });

  it('rebuilds in the same directories after a write is interrupted', () => {
    const f = fixture();
    const chunk = 'js/chunk.0x1234abcd.js';
    const bytes = 'export default 1;';

    expect(f.publish().isValid).toBe(true);
    write(f.source, chunk, bytes);
    const save = fs.writeFileSync;
    const failure = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (file !== path.join(f.assets, chunk)) return save(file, data, options);
      save(file, 'partial', options);
      throw new Error('interrupted');
    });

    try {
      expect(f.publish).toThrow('interrupted');
    } finally {
      failure.mockRestore();
    }
    expect(read(f.assets, chunk)).toBe('partial');
    expect(f.publish().isValid).toBe(true);
    expect(read(f.assets, chunk)).toBe(bytes);
  });

  it('unlinks a child file symlink without modifying its target', (context) => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    const target = path.join(f.project, 'keep.txt');
    const leaf = path.join(f.patterns, 'pages-home.html');

    write(f.project, 'keep.txt', 'private\r\n');
    fs.unlinkSync(leaf);
    try {
      fs.symlinkSync(target, leaf, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return context.skip();
      throw error;
    }
    expect(f.publish().isValid).toBe(true);
    expect(read(f.project, 'keep.txt')).toBe('private\r\n');
    expect(fs.lstatSync(leaf).isFile()).toBe(true);
  });
});
