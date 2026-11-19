// @vitest-environment node

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withCheckedFile } from './checked-file.ts';
import { runIntegration } from './integration.ts';
import { hashFileContent } from './prerender-core.ts';

const marker = '.alveo-integration.json';
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (root: string, file: string, bytes: string | Buffer) => {
  const target = path.join(root, file);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};
const fixtures: string[] = [];
const loader = 'react-loader.0xAbCdEf12.js';
const fixture = () => {
  const root = path.resolve('test/temp', 'ownership-' + randomUUID());

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

describe('owned integration publisher', () => {
  it.each(['assets', 'patterns'] as const)('refuses a first run into populated %s before touching either destination', (kind) => {
    const f = fixture();

    write(f[kind], '.gitkeep', '\r\n');
    const before = [snapshot(f.assets), snapshot(f.patterns)];

    expect(f.publish).toThrow(/unowned.*not empty/i);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
  });

  it('keeps the existing asset/hash/pattern formats, then removes only stale generated files from each destination', () => {
    const f = fixture();

    fs.mkdirSync(f.assets);
    fs.mkdirSync(f.patterns);
    const binary = Buffer.concat([Buffer.alloc(5000, 32), Buffer.from([0, 0xff, 13, 10])]);

    write(f.source, 'movie.0xaaaa.mp4', binary);
    write(f.source, 'misc/.nested/old', 'old\r\n');
    write(f.source, 'css/site.css', 'p{}\r\n');
    write(f.source, 'css/.hidden.css', '/* private */\r\n');
    write(f.source, 'js/main.js.map', JSON.stringify({ sourcesContent: ['original\r\n'] }));
    write(f.source, 'pages/deep/alt.htm', '<img src="logo.svg?v=old">\r\n');
    write(f.source, 'pages/data.csv', 'x,y\r\n');
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
    expect(read(f.patterns, 'data.csv')).toBe('x,y\r\n');
    expect(fs.existsSync(path.join(f.assets, 'pages'))).toBe(false);
    const manifest = (root: string) => JSON.parse(read(root, marker)).files;

    expect(manifest(f.assets)).toEqual(
      [
        'css/.hidden.css',
        'css/site.css',
        'hashes.json',
        'js/' + loader,
        'js/main.js',
        'js/main.js.map',
        'misc/.nested/old',
        'movie.0xaaaa.mp4',
      ].sort()
    );
    expect(manifest(f.patterns)).toEqual(['atoms-a-help.html', 'data.csv', 'deep/alt.htm', 'pages-home.html']);

    write(f.assets, 'misc/.nested/manual.txt', 'private\r\n');
    write(f.assets, 'docs-reload.txt', '\r\n');
    write(f.patterns, 'deep/manual.html', '<img src="logo.svg?v=keep">\r\n');
    const keepAsset = snapshot(path.join(f.assets, 'misc/.nested/manual.txt'));
    const keepPattern = snapshot(path.join(f.patterns, 'deep/manual.html'));

    for (const name of ['misc/.nested/old', 'movie.0xaaaa.mp4', 'pages/deep/alt.htm']) fs.unlinkSync(path.join(f.source, name));
    fs.unlinkSync(path.join(f.build, 'atoms/a/help.html'));
    write(f.source, 'movie.0xbbbb.mp4', binary);
    expect(f.publish().isValid).toBe(true);
    for (const [dir, name] of [
      [f.assets, 'misc/.nested/old'],
      [f.assets, 'movie.0xaaaa.mp4'],
      [f.patterns, 'atoms-a-help.html'],
      [f.patterns, 'deep/alt.htm'],
    ] as const) {
      expect(fs.existsSync(path.join(dir, name))).toBe(false);
      expect(manifest(dir)).not.toContain(name);
    }
    expect(manifest(f.assets)).toContain('movie.0xbbbb.mp4');
    expect(snapshot(path.join(f.assets, 'misc/.nested/manual.txt'))).toEqual(keepAsset);
    expect(snapshot(path.join(f.patterns, 'deep/manual.html'))).toEqual(keepPattern);
    expect(read(f.assets, 'docs-reload.txt')).toBe('\r\n');
    const records = [read(f.assets, marker), read(f.patterns, marker)];

    expect(f.publish().isValid).toBe(true);
    expect([read(f.assets, marker), read(f.patterns, marker)]).toEqual(records);
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

  it.each(['assets', 'patterns'] as const)('preflights unowned %s collisions before updating either owned root', (kind) => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    write(f.source, 'js/main.js', 'updated');
    write(f[kind], 'nested/manual.html', 'keep\r\n');
    write(f.source, (kind === 'assets' ? '' : 'pages/') + 'nested/manual.html', 'replace');
    const before = [snapshot(f.assets), snapshot(f.patterns)];

    expect(f.publish).toThrow(/file collision/i);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
  });

  it.each(['../outside', '/root', 'dir\\file', 'C:outside', 'foo/../outside', 'foo//file', marker, marker + '/child', 'CON', 5])(
    'rejects unsafe ownership entry %s without writing',
    (name) => {
      const f = fixture();

      expect(f.publish().isValid).toBe(true);
      write(f.patterns, marker, JSON.stringify({ version: 1, kind: 'patterns', files: [name] }));
      const before = [snapshot(f.assets), snapshot(f.patterns)];

      expect(f.publish).toThrow(/unsafe.*path/i);
      expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
    }
  );

  it.each([
    '{',
    'null',
    '{"version":2}',
    '{"version":1,"kind":"assets","files":[]}',
    '{"version":1,"kind":"patterns","files":{}}',
    '{"version":1,"kind":"patterns","files":["a","a"]}',
  ])('refuses corrupt/incompatible ownership records: %s', (record) => {
    const f = fixture();

    write(f.patterns, marker, record);
    expect(f.publish).toThrow();
    expect(fs.existsSync(f.assets)).toBe(false);
    expect(read(f.patterns, marker)).toBe(record);
  });

  it.each([
    ['atoms/a/b.html', 'assets/pages/atoms-a-b.html', /duplicate/i],
    ['atoms/a/b.html', 'atoms/a-b.html', /duplicate/i],
    ['pages/x.html', 'assets/pages/pages-x.html/child.html', /parent collision/i],
    ['atoms/a/B.html', 'atoms/a-b.html', /ambiguous/i],
    ['assets/' + marker, 'assets/file', /unsafe/i],
  ] as const)('rejects ambiguous generated outputs: %s and %s', (first, second, reason) => {
    const f = fixture();

    write(f.build, first, 'one');
    write(f.build, second, 'two');
    expect(f.publish).toThrow(reason);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual([null, null]);
  });

  it('retains validated root junctions and unrelated child links; refuses junctions on a stale or new path', () => {
    const f = fixture();
    const actual = path.join(f.root, 'actual');

    fs.mkdirSync(actual);
    fs.symlinkSync(actual, f.patterns, 'junction');
    write(f.source, 'pages/deep/sample.html', 'sample');
    expect(f.publish().isValid).toBe(true);
    fs.symlinkSync(f.project, path.join(f.assets, 'unrelated'), 'junction');
    fs.symlinkSync(path.join(f.root, 'absent'), path.join(f.assets, 'dangling'), 'junction');
    expect(f.publish().isValid).toBe(true);
    expect(fs.lstatSync(f.patterns).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(f.assets, 'dangling')).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(path.join(f.assets, 'unrelated'))).toBe(fs.realpathSync(f.project));
    fs.rmSync(path.join(actual, 'deep'), { recursive: true });
    fs.unlinkSync(path.join(f.source, 'pages/deep/sample.html'));
    write(f.project, 'sample.html', 'keep\r\n');
    fs.symlinkSync(f.project, path.join(actual, 'deep'), 'junction');
    const before = snapshot(f.assets);

    expect(f.publish).toThrow(/parent collision/i);
    expect(snapshot(f.assets)).toEqual(before);
    expect(read(f.project, 'sample.html')).toBe('keep\r\n');
    fs.unlinkSync(path.join(actual, 'deep'));
    write(f.source, 'dangling/new', 'new');
    expect(f.publish).toThrow(/parent collision/i);
    expect(fs.existsSync(path.join(f.root, 'absent'))).toBe(false);
  });

  it('refuses a directory/link substituted for an owned file or the record, and links in generated inputs', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    const home = path.join(f.patterns, 'pages-home.html');

    fs.unlinkSync(home);
    fs.symlinkSync(f.project, home, 'junction');
    expect(f.publish).toThrow(/file collision/i);
    fs.unlinkSync(home);
    fs.unlinkSync(path.join(f.patterns, marker));
    fs.symlinkSync(f.project, path.join(f.patterns, marker), 'junction');
    expect(f.publish).toThrow(/regular ownership record/i);
    expect(fs.lstatSync(path.join(f.patterns, marker)).isSymbolicLink()).toBe(true);
    fs.symlinkSync(f.project, path.join(f.source, 'source-link'), 'junction');
    expect(f.publish).toThrow(/regular build output/i);
    fs.unlinkSync(path.join(f.source, 'source-link'));
    fs.symlinkSync(f.project, path.join(f.build, 'atoms'), 'junction');
    expect(f.publish).toThrow(/expected build directory/i);
  });

  it('does not truncate shared hard links when replacing owned files and records', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    const initial = read(f.assets, marker);

    fs.linkSync(path.join(f.assets, 'js/main.js'), path.join(f.project, 'keep.js'));
    fs.linkSync(path.join(f.assets, marker), path.join(f.project, 'keep.json'));
    write(f.source, 'js/main.js', 'new');
    write(f.source, 'other', 'new');
    expect(f.publish().isValid).toBe(true);
    expect(read(f.project, 'keep.js')).toBe('old();\n');
    expect(read(f.project, 'keep.json')).toBe(initial);
  });

  it('can retry a failed write if no new unrecorded file survived', () => {
    const f = fixture();

    expect(f.publish().isValid).toBe(true);
    const records = [read(f.assets, marker), read(f.patterns, marker)];

    write(f.source, 'new.txt', 'new');
    const failed = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('device full');
    });

    try {
      expect(f.publish).toThrow('device full');
    } finally {
      failed.mockRestore();
    }
    expect([read(f.assets, marker), read(f.patterns, marker)]).toEqual(records);
    expect(f.publish().isValid).toBe(true);
    expect(read(f.assets, 'new.txt')).toBe('new');
  });

  it.each(['publisher', 'consumer'])('does not claim an unrecorded chunk left by the %s on retry', (writer) => {
    const f = fixture();
    const chunk = 'js/chunk.0x1234abcd.js';
    const bytes = 'export default 1;';

    expect(f.publish().isValid).toBe(true);
    write(f.source, chunk, bytes);
    const save = fs.writeFileSync;
    const failure = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (file !== path.join(f.assets, chunk)) return save(file, data, options);
      if (writer === 'publisher') save(file, data, options);
      throw new Error('interrupted');
    });

    try {
      expect(f.publish).toThrow('interrupted');
    } finally {
      failure.mockRestore();
    }
    // Both histories give a digest-based retry exactly the same evidence.
    if (writer === 'consumer') write(f.assets, chunk, bytes);
    expect(read(f.assets, chunk)).toBe(bytes);
    expect(JSON.parse(read(f.assets, marker)).files).not.toContain(chunk);
    const before = [snapshot(f.assets), snapshot(f.patterns)];

    expect(f.publish).toThrow(/file collision/i);
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
    const fresh = path.join(f.root, 'fresh-assets');
    const patterns = path.join(f.root, 'fresh-patterns');

    vi.stubEnv('VITE_INTE_ASSET_DIR', fresh);
    vi.stubEnv('VITE_INTE_PATTERN_DIR', patterns);
    expect(f.publish().isValid).toBe(true);
    expect(JSON.parse(read(fresh, marker)).files).toContain(chunk);
    expect(read(fresh, chunk)).toBe(bytes);
    expect(read(patterns, 'pages-home.html')).toBe(read(f.patterns, 'pages-home.html'));
    expect([snapshot(f.assets), snapshot(f.patterns)]).toEqual(before);
  });

  it('refuses file symlinks on owned leaves, even when dangling, without normalizing their targets', (context) => {
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
    const before = snapshot(f.assets);

    expect(f.publish).toThrow(/file collision/i);
    expect(read(f.project, 'keep.txt')).toBe('private\r\n');
    fs.unlinkSync(target);
    expect(f.publish).toThrow(/file collision/i);
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
    expect(snapshot(f.assets)).toEqual(before);
  });
});
