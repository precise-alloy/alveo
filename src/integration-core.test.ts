// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { globSync } from 'glob';
import slash from 'slash';
import { describe, expect, it, vi } from 'vitest';

import {
  getPatternCopyTarget,
  normalizePatternHtml,
  parseIntegrationArgs,
  copyConfiguredItems,
  collectAssetHashes,
  sortHashes,
  normalizeGeneratedTextFiles,
  copyPatternArtifacts,
  normalizePatternFiles,
  validateDestinations,
  validateExpectedFiles,
  runIntegrationBuild,
  getUnlistedCopyItems,
  IntegrationDependencies,
  IntegrationConfig,
} from './integration-core.ts';

describe('alveo/integration-core.ts', () => {
  describe('getPatternCopyTarget', () => {
    describe('relative paths (no staticBasePath)', () => {
      it('maps a two-segment relative path to a joined target name', () => {
        const result = getPatternCopyTarget('/patterns', 'atoms/button.html');

        expect(result).toEqual({
          sourcePath: 'atoms/button.html',
          targetPath: '/patterns/atoms-button.html',
          recursive: false,
        });
      });

      it('sets recursive: true for paths with more than 2 segments', () => {
        const result = getPatternCopyTarget('/patterns', 'organisms/hero/index.html');

        expect(result).toEqual({
          sourcePath: 'organisms/hero/index.html',
          targetPath: '/patterns/organisms-hero-index.html',
          recursive: true,
        });
      });

      it('returns undefined for paths with fewer than 2 segments', () => {
        expect(getPatternCopyTarget('/patterns', 'file.html')).toBeUndefined();
      });
    });

    describe('absolute paths with staticBasePath', () => {
      it('computes the relative path from staticBasePath before mapping', () => {
        const result = getPatternCopyTarget('/patterns', '/build/static/atoms/button.html', '/build/static');

        expect(result).toEqual({
          sourcePath: '/build/static/atoms/button.html',
          targetPath: '/patterns/atoms-button.html',
          recursive: false,
        });
      });

      it('sets recursive: true for nested static paths with > 2 segments', () => {
        const result = getPatternCopyTarget('/patterns', '/build/static/organisms/hero/index.html', '/build/static');

        expect(result).toEqual({
          sourcePath: '/build/static/organisms/hero/index.html',
          targetPath: '/patterns/organisms-hero-index.html',
          recursive: true,
        });
      });

      it('returns undefined when the relative path from staticBasePath has < 2 segments', () => {
        const result = getPatternCopyTarget('/patterns', '/build/static/file.html', '/build/static');

        expect(result).toBeUndefined();
      });
    });
  });

  describe('normalizePatternHtml', () => {
    it('normalizes react-loader hashes to a fixed placeholder', () => {
      const input = '<script src="/assets/js/react-loader.0xAbCdEf12.js"></script>';
      const expected = '<script src="/assets/js/react-loader.0x00000000.js"></script>';

      expect(normalizePatternHtml(input)).toBe(expected);
    });

    it('strips SVG cache buster query strings', () => {
      const input = '<img src="/assets/images/icon.svg?v=abc123_-">';
      const expected = '<img src="/assets/images/icon.svg">';

      expect(normalizePatternHtml(input)).toBe(expected);
    });

    it('collapses blank lines between </footer> and pl-states script', () => {
      const input = '</footer>\n\n\n  <script type="module"\n  defer=""\n  src="/assets/js/pl-states.js"></script>';
      const expected = '</footer>\n  <script type="module"\n  defer=""\n  src="/assets/js/pl-states.js"></script>';

      expect(normalizePatternHtml(input)).toBe(expected);
    });

    it('normalizes CRLF line endings to LF', () => {
      const input = '<div>\r\n  <p>hello</p>\r\n</div>';
      const expected = '<div>\n  <p>hello</p>\n</div>';

      expect(normalizePatternHtml(input)).toBe(expected);
    });

    it('omits the runtime preload without reformatting the backend sample', () => {
      const input = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '  <script type="module"',
        '    src="/assets/js/react-loader.0xAbCdEf12.js"></script>',
        '  <link rel="modulepreload"',
        '    crossorigin=""',
        '    href="/assets/js/rolldown-runtime.0xD9-fqq9M.js">',
        '  <link href="/assets/css/header.css"',
        '    rel="stylesheet">',
        '</head>',
        '<body></body>',
        '</html>',
      ].join('\r\n');
      const expected = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '  <script type="module"',
        '    src="/assets/js/react-loader.0x00000000.js"></script>',
        '  <link href="/assets/css/header.css"',
        '    rel="stylesheet">',
        '</head>',
        '<body></body>',
        '</html>',
      ].join('\n');

      expect(normalizePatternHtml(input)).toBe(expected);
    });

    it.each([
      ['assets/js/rolldown-runtime.0xD9-fqq9M.js'],
      ['/subpath/assets/js/rolldown-runtime.0xAbCdEf1234_-.js?v=123#helper'],
      ['https://cdn.example.com/assets/js/rolldown-runtime.0xD9-fqq9M.js'],
    ])('omits runtime preloads with the URL %s', (href) => {
      const link = `<link crossorigin href='${href}' rel='modulepreload'>`;

      expect(normalizePatternHtml(link)).toBe('');
      expect(normalizePatternHtml(`  ${link}  \n<p>Keep</p>`)).toBe('<p>Keep</p>');
      expect(normalizePatternHtml(`<head>${link}</head>`)).toBe('<head></head>');
      expect(normalizePatternHtml(`${link}<script src="/main.js"></script>`)).toBe('<script src="/main.js"></script>');
    });

    it('removes multiple runtime hints but preserves other preloads and script/comment examples', () => {
      const runtime = '/assets/js/rolldown-runtime.0xD9-fqq9M.js';
      const keep = [
        '<link rel="modulepreload" href="/assets/js/vendor.0xAbCdEf12.js">',
        `<link rel="preload" as="script" href="${runtime}">`,
        `<link rel="stylesheet" href="${runtime}">`,
        '<link rel="modulepreload">',
        '<link rel="modulepreload" href="/assets/js/rolldown-runtime.0xshort.js">',
        '<link rel="modulepreload" href="/assets/js/not-rolldown-runtime.0xD9-fqq9M.js">',
        '<link rel="modulepreload" href="/assets/js/rolldown-runtime.0xD9-fqq9M.js.txt">',
        `<link rel="modulepreload" href="/assets/js/app.js?next=${runtime}">`,
        `<link rel="modulepreload" href="/assets/js/app.js#${runtime}">`,
        `<!-- <link rel="modulepreload" href="${runtime}"> -->`,
        `<script>const example = '<link rel="modulepreload" href="${runtime}">';</script>`,
      ].join('\n');
      const input = `<link rel="modulepreload" href="${runtime}">\n${keep}\n  <link rel="modulepreload" href="${runtime}">`;

      expect(normalizePatternHtml(input)).toBe(keep + '\n');
      expect(normalizePatternHtml(keep)).toBe(keep);
    });

    it('applies all normalizations together', () => {
      const input =
        '<img src="/assets/images/logo.svg?v=xyz">\r\n<script src="/assets/js/react-loader.0xBBBBBBBB.js"></script>\r\n</footer>\n\n\n  <script type="module"\n  defer=""\n  src="/assets/js/pl-states.js"></script>';
      const result = normalizePatternHtml(input);

      expect(result).toContain('logo.svg"');
      expect(result).not.toContain('?v=');
      expect(result).toContain('react-loader.0x00000000.js');
      expect(result).not.toContain('\r\n');
    });
  });

  const buildDeps = (overrides: Partial<IntegrationDependencies> = {}): IntegrationDependencies => ({
    existsSync: vi.fn().mockReturnValue(true) as never,
    statSync: vi.fn().mockReturnValue({ isDirectory: () => false }) as never,
    rmSync: vi.fn() as never,
    mkdirSync: vi.fn() as never,
    cpSync: vi.fn() as never,
    copyFileSync: vi.fn() as never,
    readFileSync: vi.fn().mockReturnValue(Buffer.from('content')) as never,
    writeFileSync: vi.fn() as never,
    readdirSync: vi.fn().mockReturnValue([]) as never,
    globSync: vi.fn().mockReturnValue([]) as never,
    log: vi.fn() as never,
    warn: vi.fn((value: string) => value) as never,
    ...overrides,
  });

  const filesystemDependencies: IntegrationDependencies = {
    ...fs,
    readFileSync: (file, encoding) => (encoding ? fs.readFileSync(file, encoding) : fs.readFileSync(file)),
    readdirSync: (folder) => fs.readdirSync(folder),
    globSync,
    log: vi.fn(),
    warn: (value) => value,
  };

  describe('parseIntegrationArgs', () => {
    it('parses --mode from argv', () => {
      const result = parseIntegrationArgs(['node', 'script', '--mode', 'development']);

      expect(result.mode).toBe('development');
    });

    it('defaults mode to "production" when --mode is not present', () => {
      const result = parseIntegrationArgs(['node', 'script']);

      expect(result.mode).toBe('production');
    });

    it('defaults mode to "production" when --mode value starts with "-"', () => {
      const result = parseIntegrationArgs(['node', 'script', '--mode', '--other']);

      expect(result.mode).toBe('production');
    });
  });

  describe('validateDestinations', () => {
    it('rejects an empty asset destination', () => {
      const result = validateDestinations('', undefined, '/project');

      expect(result).toEqual({ ok: false, reasons: ['VITE_INTE_ASSET_DIR is empty'] });
    });

    it('rejects an asset destination that resolves to the project root', () => {
      const result = validateDestinations('/project', undefined, '/project');

      expect(result).toEqual({ ok: false, reasons: ['VITE_INTE_ASSET_DIR resolves to project root'] });
    });

    it('rejects an asset destination that is an ancestor of the project root', () => {
      const result = validateDestinations('/workspace', undefined, '/workspace/project');

      expect(result).toEqual({ ok: false, reasons: ['VITE_INTE_ASSET_DIR is an ancestor of project root'] });
    });

    it('rejects a set pattern destination that resolves to the project root', () => {
      const result = validateDestinations('/output', '/project', '/project');

      expect(result).toEqual({ ok: false, reasons: ['VITE_INTE_PATTERN_DIR resolves to project root'] });
    });

    it('rejects a set pattern destination that is an ancestor of the project root', () => {
      const result = validateDestinations('/output', '/workspace', '/workspace/project');

      expect(result).toEqual({ ok: false, reasons: ['VITE_INTE_PATTERN_DIR is an ancestor of project root'] });
    });

    it('allows an unset pattern destination', () => {
      const result = validateDestinations('/workspace/output', undefined, '/workspace/project');

      expect(result).toEqual({ ok: true, reasons: [] });
    });

    it('allows destinations outside the project root ancestry', () => {
      const result = validateDestinations('/workspace/output/assets', '/workspace/output/patterns', '/workspace/project');

      expect(result).toEqual({ ok: true, reasons: [] });
    });
  });

  describe('copyConfiguredItems', () => {
    it('copies a file to the default destination', () => {
      const copyFileSync = vi.fn();
      const deps = buildDeps({ copyFileSync });

      copyConfiguredItems([{ from: 'file.txt' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(copyFileSync).toHaveBeenCalled();
    });

    it('copies a file to a custom destination when "to" is specified', () => {
      const copyFileSync = vi.fn();
      const deps = buildDeps({ copyFileSync });

      copyConfiguredItems([{ from: 'file.txt', to: '/custom/output.txt' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(copyFileSync).toHaveBeenCalledWith(expect.stringContaining('file.txt'), '/custom/output.txt');
    });

    it('skips items when source does not exist', () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const copyFileSync = vi.fn();
      const deps = buildDeps({ existsSync, copyFileSync });

      copyConfiguredItems([{ from: 'missing.txt' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(copyFileSync).not.toHaveBeenCalled();
    });

    it('copies directories recursively', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      const cpSync = vi.fn();
      const mkdirSync = vi.fn();
      const deps = buildDeps({ existsSync, statSync, cpSync, mkdirSync });

      copyConfiguredItems([{ from: 'dir' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(mkdirSync).toHaveBeenCalled();
      expect(cpSync).toHaveBeenCalledWith(expect.any(String), expect.any(String), { recursive: true, force: true });
    });

    it('removes existing destination directory before copying a directory', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      const rmSync = vi.fn();
      const deps = buildDeps({ existsSync, statSync, rmSync });

      copyConfiguredItems([{ from: 'dir' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(rmSync).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
    });

    it('creates parent directory for files when it does not exist', () => {
      const existsSync = vi.fn().mockImplementation((p: string) => {
        // Source exists, but dest dir does not
        if (p.includes('src')) return true;

        return false;
      });
      const mkdirSync = vi.fn();
      const deps = buildDeps({ existsSync, mkdirSync });

      copyConfiguredItems([{ from: 'sub/file.txt' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('logs a message for each copied item', () => {
      const log = vi.fn();
      const deps = buildDeps({ log });

      copyConfiguredItems([{ from: 'a.txt' }, { from: 'b.txt' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(log).toHaveBeenCalledTimes(2);
    });

    it('copies a directory without removing destination when it does not exist', () => {
      const existsSync = vi.fn().mockImplementation((p: string) => {
        // Source path exists, but destination does not
        if (p.includes('src')) return true;

        return false;
      });
      const statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      const rmSync = vi.fn();
      const mkdirSync = vi.fn();
      const cpSync = vi.fn();
      const deps = buildDeps({ existsSync, statSync, rmSync, mkdirSync, cpSync });

      copyConfiguredItems([{ from: 'dir' }], { srcBasePath: '/src', destBasePath: '/dest' }, deps);

      expect(rmSync).not.toHaveBeenCalled();
      expect(mkdirSync).toHaveBeenCalled();
      expect(cpSync).toHaveBeenCalled();
    });
  });

  describe('collectAssetHashes', () => {
    it('collects hashes from globbed files', () => {
      const globSync = vi.fn().mockReturnValue(['/static/assets/style.css']);
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('css content'));
      const deps = buildDeps({ globSync, readFileSync });

      const hashes = collectAssetHashes(['assets'], { staticBasePath: '/static', srcBasePath: '/src' }, deps);

      expect(hashes.size).toBe(1);
      expect(hashes.has('/assets/style.css')).toBe(true);
      expect(hashes.get('/assets/style.css')).toBeTruthy();
    });

    it('sets empty hash for files with content hash in their name', () => {
      const globSync = vi.fn().mockReturnValue(['/static/assets/app.0xabcdef12.js']);
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('js'));
      const deps = buildDeps({ globSync, readFileSync });

      const hashes = collectAssetHashes(['assets'], { staticBasePath: '/static', srcBasePath: '/src' }, deps);

      expect(hashes.get('/assets/app.0xabcdef12.js')).toBe('');
    });

    it('processes multiple hash items', () => {
      const globSync = vi.fn().mockReturnValueOnce(['/static/styles/main.css']).mockReturnValueOnce(['/static/scripts/app.js']);
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('content'));
      const deps = buildDeps({ globSync, readFileSync });

      const hashes = collectAssetHashes(['styles', 'scripts'], { staticBasePath: '/static', srcBasePath: '/src' }, deps);

      expect(hashes.size).toBe(2);
    });
  });

  describe('sortHashes', () => {
    it('sorts map entries alphabetically by key', () => {
      const hashes = new Map<string, string>([
        ['/z-file.css', 'hash1'],
        ['/a-file.css', 'hash2'],
        ['/m-file.css', 'hash3'],
      ]);

      const sorted = sortHashes(hashes);
      const keys = Object.keys(sorted);

      expect(keys).toEqual(['/a-file.css', '/m-file.css', '/z-file.css']);
    });

    it('returns a plain object', () => {
      const hashes = new Map<string, string>([['/file.css', 'hash1']]);
      const sorted = sortHashes(hashes);

      expect(sorted).toEqual({ '/file.css': 'hash1' });
    });

    it('handles an empty map', () => {
      const sorted = sortHashes(new Map());

      expect(sorted).toEqual({});
    });
  });

  describe('normalizeGeneratedTextFiles', () => {
    it('normalizes text file content and writes it back', () => {
      const globSync = vi.fn().mockReturnValue(['/dest/file.css']);
      const readFileSync = vi.fn().mockReturnValue('line1\r\nline2\r\n');
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizeGeneratedTextFiles('/dest', deps);

      expect(globSync).toHaveBeenCalledWith(slash(path.join('/dest', '**/*')), { nodir: true, dot: true });
      expect(writeFileSync).toHaveBeenCalledWith('/dest/file.css', 'line1\nline2\n');
    });

    it('does not write when content is unchanged', () => {
      const globSync = vi.fn().mockReturnValue(['/dest/file.css']);
      const readFileSync = vi.fn().mockReturnValue('already\nnormalized\n');
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizeGeneratedTextFiles('/dest', deps);

      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('handles Buffer content from readFileSync', () => {
      const globSync = vi.fn().mockReturnValue(['/dest/file.css']);
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('line1\r\nline2\r\n'));
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizeGeneratedTextFiles('/dest', deps);

      expect(writeFileSync).toHaveBeenCalledWith('/dest/file.css', 'line1\nline2\n');
    });

    it('leaves binary generated assets byte-for-byte while normalizing text files', () => {
      const extensionlessBinary = Buffer.from([0x00, 0x01, 0x02, 0xff]);
      const pngBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]);
      const woff2Binary = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const files = ['/dest/assets/blob', '/dest/assets/image.png', '/dest/assets/font.woff2', '/dest/assets/app.js'];
      const fileContents: Record<string, Buffer> = {
        '/dest/assets/blob': extensionlessBinary,
        '/dest/assets/image.png': pngBinary,
        '/dest/assets/font.woff2': woff2Binary,
        '/dest/assets/app.js': Buffer.from('const value = 1;\r\n'),
      };
      const globSync = vi.fn().mockReturnValue(files);
      const readFileSync = vi.fn((file: string) => fileContents[file]);
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync: readFileSync as never, writeFileSync });

      normalizeGeneratedTextFiles('/dest', deps);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      expect(writeFileSync).toHaveBeenCalledWith('/dest/assets/app.js', 'const value = 1;\n');
      expect(fileContents['/dest/assets/blob']).toBe(extensionlessBinary);
      expect(fileContents['/dest/assets/image.png']).toBe(pngBinary);
      expect(fileContents['/dest/assets/font.woff2']).toBe(woff2Binary);
    });
  });

  describe('copyPatternArtifacts', () => {
    it('creates the pattern directory', () => {
      const mkdirSync = vi.fn();
      const deps = buildDeps({ mkdirSync });

      copyPatternArtifacts('/patterns', '/static', deps);

      expect(mkdirSync).toHaveBeenCalledWith('/patterns', { recursive: true });
    });

    it('copies files using copyFileSync for non-recursive targets', () => {
      const globSync = vi.fn().mockReturnValue(['/static/atoms/button.html']);
      const copyFileSync = vi.fn();
      const deps = buildDeps({ globSync, copyFileSync });

      copyPatternArtifacts('/patterns', '/static', deps);

      expect(copyFileSync).toHaveBeenCalled();
    });

    it('copies directories using cpSync for recursive targets', () => {
      const globSync = vi.fn().mockReturnValue(['/static/organisms/hero/index.html']);
      const cpSync = vi.fn();
      const deps = buildDeps({ globSync, cpSync });

      copyPatternArtifacts('/patterns', '/static', deps);

      expect(cpSync).toHaveBeenCalledWith(expect.any(String), expect.any(String), { recursive: true });
    });

    it('skips files that produce no valid copy target', () => {
      const globSync = vi.fn().mockReturnValue(['/static/file.html']);
      const copyFileSync = vi.fn();
      const cpSync = vi.fn();
      const deps = buildDeps({ globSync, copyFileSync, cpSync });

      copyPatternArtifacts('/patterns', '/static', deps);

      expect(copyFileSync).not.toHaveBeenCalled();
      expect(cpSync).not.toHaveBeenCalled();
    });
  });

  describe('normalizePatternFiles', () => {
    it('normalizes HTML pattern files and writes changes', () => {
      const globSync = vi.fn().mockReturnValue(['/patterns/atoms-button.html']);
      const readFileSync = vi.fn().mockReturnValue('<img src="/assets/images/icon.svg?v=abc123">');
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizePatternFiles('/patterns', deps);

      expect(writeFileSync).toHaveBeenCalledWith('/patterns/atoms-button.html', '<img src="/assets/images/icon.svg">');
    });

    it('does not write when pattern HTML is already normalized', () => {
      const globSync = vi.fn().mockReturnValue(['/patterns/atoms-button.html']);
      const readFileSync = vi.fn().mockReturnValue('<div>clean html</div>');
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizePatternFiles('/patterns', deps);

      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('handles Buffer return from readFileSync', () => {
      const globSync = vi.fn().mockReturnValue(['/patterns/atoms-button.html']);
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('<img src="/assets/images/icon.svg?v=abc123">'));
      const writeFileSync = vi.fn();
      const deps = buildDeps({ globSync, readFileSync, writeFileSync });

      normalizePatternFiles('/patterns', deps);

      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe('validateExpectedFiles', () => {
    it('returns isValid: true when all string file names exist', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const deps = buildDeps({ existsSync });

      const result = validateExpectedFiles([{ fileName: 'index.html' }], '/dest', deps);

      expect(result.isValid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns isValid: false with missing paths when file does not exist', () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const warn = vi.fn((v: string) => v);
      const log = vi.fn();
      const deps = buildDeps({ existsSync, warn, log });

      const result = validateExpectedFiles([{ fileName: 'missing.html' }], '/dest', deps);

      expect(result.isValid).toBe(false);
      expect(result.missing).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    });

    it('checks regex file names against directory contents', () => {
      const readdirSync = vi.fn().mockReturnValue(['app.0xabcdef12.js', 'style.css']);
      const deps = buildDeps({ readdirSync });

      const result = validateExpectedFiles([{ fileName: /app\.0x[a-z0-9]+\.js/ }], '/dest', deps);

      expect(result.isValid).toBe(true);
    });

    it('reports missing when regex file name has no match in directory', () => {
      const readdirSync = vi.fn().mockReturnValue(['style.css']);
      const warn = vi.fn((v: string) => v);
      const log = vi.fn();
      const deps = buildDeps({ readdirSync, warn, log });

      const result = validateExpectedFiles([{ fileName: /app\.0x[a-z0-9]+\.js/ }], '/dest', deps);

      expect(result.isValid).toBe(false);
      expect(result.missing).toHaveLength(1);
    });

    it('uses the folder sub-path when specified', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const deps = buildDeps({ existsSync });

      validateExpectedFiles([{ folder: 'assets', fileName: 'style.css' }], '/dest', deps);

      expect(existsSync).toHaveBeenCalledWith(expect.stringContaining('assets'));
    });
  });

  describe('getUnlistedCopyItems', () => {
    it('returns sorted top-level entries not covered by configured items', () => {
      const deps = buildDeps({
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue(['video.0xabc.mp4', 'css', 'docs', 'hashes.json', 'pages']),
      });

      expect(getUnlistedCopyItems([{ from: 'css' }, { from: 'hashes.json' }, { from: 'pages', to: '/p' }], '/src', deps)).toEqual([
        { from: 'docs' },
        { from: 'video.0xabc.mp4' },
      ]);
    });

    it('returns nothing when the source directory is missing', () => {
      const readdirSync = vi.fn();
      const deps = buildDeps({ existsSync: vi.fn().mockReturnValue(false), readdirSync });

      expect(getUnlistedCopyItems([], '/missing', deps)).toEqual([]);
      expect(readdirSync).not.toHaveBeenCalled();
    });
  });

  describe('runIntegrationBuild', () => {
    it('omits runtime preload hints only from patterns while preserving static HTML and imported assets', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-inte-runtime-'));

      try {
        const staticBasePath = slash(path.join(root, 'project/dist/static'));
        const srcBasePath = slash(path.join(staticBasePath, 'assets'));
        const destBasePath = slash(path.join(root, 'integration/assets'));
        const patternPath = slash(path.join(root, 'integration/patterns'));
        const runtimeName = 'rolldown-runtime.0xD9-fqq9M.js';
        const loaderName = 'react-loader.0xAbCdEf12.js';
        const runtime = 'export const initialize = () => 1;\n';
        const loader = `import { initialize } from './${runtimeName}';\ninitialize();\n`;
        const preload = `  <link rel="modulepreload" href="/assets/js/${runtimeName}">\n`;
        const html = [
          '<html><head>',
          `  <script type="module" src="/assets/js/${loaderName}"></script>`,
          '  <link rel="modulepreload" href="/assets/js/vendor.0xAbCdEf12.js">',
          '</head><body>Sample</body></html>',
        ].join('\n');
        const staticHtml = html.replace('</head>', preload + '</head>');

        fs.mkdirSync(path.join(srcBasePath, 'js'), { recursive: true });
        fs.mkdirSync(path.join(staticBasePath, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(srcBasePath, 'js', runtimeName), runtime);
        fs.writeFileSync(path.join(srcBasePath, 'js', loaderName), loader);
        fs.writeFileSync(path.join(staticBasePath, 'pages/home.html'), staticHtml);

        const result = runIntegrationBuild(
          {
            argv: [],
            staticBasePath,
            srcBasePath,
            destBasePath,
            patternPath,
            copyItems: [{ from: 'js' }],
            hashItems: ['js'],
            checkExistFileList: [{ folder: 'js', fileName: runtimeName }],
          },
          filesystemDependencies
        );

        expect(result).toEqual({ isValid: true, missing: [] });
        expect(fs.readFileSync(path.join(staticBasePath, 'pages/home.html'), 'utf8')).toBe(staticHtml);
        expect(fs.readFileSync(path.join(patternPath, 'pages-home.html'), 'utf8')).toBe(html.replace(loaderName, 'react-loader.0x00000000.js'));
        expect(fs.readFileSync(path.join(destBasePath, 'js', runtimeName), 'utf8')).toBe(runtime);
        expect(fs.readFileSync(path.join(destBasePath, 'js', loaderName), 'utf8')).toBe(loader);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    // Destination validation covers directories, not entries inside them. A
    // pre-existing link at a write target must be replaced, never followed.
    it('replaces destination symlinks instead of writing through them to project files', (context) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-inte-links-'));

      try {
        const project = path.join(root, 'project');
        const staticBasePath = slash(path.join(project, 'dist/static'));
        const srcBasePath = slash(path.join(staticBasePath, 'assets'));
        const destBasePath = slash(path.join(root, 'integration/assets'));
        const keep = path.join(project, 'keep.txt');

        fs.mkdirSync(srcBasePath, { recursive: true });
        fs.mkdirSync(destBasePath, { recursive: true });
        fs.writeFileSync(keep, 'project data\r\n');
        fs.writeFileSync(path.join(srcBasePath, 'video.mp4'), Buffer.from([0, 1, 2]));

        try {
          // copy target, hashes.json target, and a stale normalized text file
          for (const name of ['video.mp4', 'hashes.json', 'stale.txt']) fs.symlinkSync(keep, path.join(destBasePath, name), 'file');
        } catch (error) {
          // Unprivileged Windows shells cannot create file symlinks.
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return context.skip();
          throw error;
        }

        runIntegrationBuild(
          { argv: [], staticBasePath, srcBasePath, destBasePath, copyItems: [], hashItems: [], checkExistFileList: [] },
          filesystemDependencies
        );

        expect(fs.readFileSync(keep, 'utf8')).toBe('project data\r\n');
        expect(fs.lstatSync(path.join(destBasePath, 'video.mp4')).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(destBasePath, 'video.mp4')).equals(Buffer.from([0, 1, 2]))).toBe(true);
        expect(fs.lstatSync(path.join(destBasePath, 'hashes.json')).isSymbolicLink()).toBe(false);
        expect(fs.existsSync(path.join(destBasePath, 'stale.txt'))).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('copies root-level emitted binary assets byte-for-byte with real filesystem calls', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-inte-root-assets-'));

      try {
        const staticBasePath = slash(path.join(root, 'dist/static'));
        const srcBasePath = slash(path.join(staticBasePath, 'assets'));
        const destBasePath = slash(path.join(root, 'integration/assets'));
        // NUL and CRLF bytes: any text normalization would corrupt this file.
        const video = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x0d, 0x0a, 0xff, 0xfe, 0x0d, 0x0a]);

        fs.mkdirSync(path.join(srcBasePath, 'css'), { recursive: true });
        fs.mkdirSync(path.join(srcBasePath, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(srcBasePath, 'css/site.css'), 'a{}');
        fs.writeFileSync(path.join(srcBasePath, 'video.0xabc12345.mp4'), video);
        fs.writeFileSync(path.join(srcBasePath, 'docs/guide.pdf'), video);

        const result = runIntegrationBuild(
          { argv: [], staticBasePath, srcBasePath, destBasePath, copyItems: [{ from: 'css' }], hashItems: [], checkExistFileList: [] },
          filesystemDependencies
        );

        expect(result.isValid).toBe(true);
        expect(fs.readFileSync(path.join(destBasePath, 'css/site.css'), 'utf8')).toBe('a{}');
        expect(fs.readFileSync(path.join(destBasePath, 'video.0xabc12345.mp4')).equals(video)).toBe(true);
        expect(fs.readFileSync(path.join(destBasePath, 'docs/guide.pdf')).equals(video)).toBe(true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('mirrors consecutive builds, removing obsolete root files, folders and hidden entries', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-inte-mirror-'));

      try {
        const staticBasePath = slash(path.join(root, 'project/dist/static'));
        const srcBasePath = slash(path.join(staticBasePath, 'assets'));
        const destBasePath = slash(path.join(root, 'output'));
        const video = Buffer.from([0, 0x0d, 0x0a, 0xff]);
        const config: IntegrationConfig = {
          argv: [],
          staticBasePath,
          srcBasePath,
          destBasePath,
          copyItems: [{ from: 'css' }],
          hashItems: ['css'],
          checkExistFileList: [{ fileName: 'hashes.json' }],
        };

        fs.mkdirSync(path.join(srcBasePath, 'css'), { recursive: true });
        fs.mkdirSync(path.join(srcBasePath, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(srcBasePath, 'css/site.css'), 'a{}\r\n');
        fs.writeFileSync(path.join(srcBasePath, 'movie.0xaaaaaaaa.mp4'), video);
        fs.writeFileSync(path.join(srcBasePath, 'docs/guide.pdf'), video);
        fs.writeFileSync(path.join(srcBasePath, '.previous'), 'old');
        expect(runIntegrationBuild(config, filesystemDependencies).isValid).toBe(true);
        const originalDirectory = fs.statSync(destBasePath).ino;

        fs.unlinkSync(path.join(srcBasePath, 'movie.0xaaaaaaaa.mp4'));
        fs.rmSync(path.join(srcBasePath, 'docs'), { recursive: true });
        fs.unlinkSync(path.join(srcBasePath, '.previous'));
        fs.writeFileSync(path.join(srcBasePath, 'movie.0xbbbbbbbb.mp4'), video);
        fs.writeFileSync(path.join(srcBasePath, '.current'), 'current\r\n');
        fs.writeFileSync(path.join(destBasePath, '.gitkeep'), '');
        fs.writeFileSync(path.join(destBasePath, 'unmanaged.txt'), 'not preserved');
        expect(runIntegrationBuild(config, filesystemDependencies).isValid).toBe(true);

        expect(fs.readdirSync(destBasePath).sort()).toEqual(['.current', 'css', 'hashes.json', 'movie.0xbbbbbbbb.mp4']);
        expect(fs.readFileSync(path.join(destBasePath, 'movie.0xbbbbbbbb.mp4'))).toEqual(video);
        expect(fs.readFileSync(path.join(destBasePath, 'css/site.css'), 'utf8')).toBe('a{}\n');
        expect(fs.readFileSync(path.join(destBasePath, '.current'), 'utf8')).toBe('current\n');
        expect(Object.keys(JSON.parse(fs.readFileSync(path.join(destBasePath, 'hashes.json'), 'utf8')))).toEqual(['/assets/css/site.css']);
        expect(fs.statSync(destBasePath).ino).toBe(originalDirectory);

        fs.rmSync(path.join(srcBasePath, 'css'), { recursive: true });
        fs.unlinkSync(path.join(srcBasePath, 'movie.0xbbbbbbbb.mp4'));
        fs.unlinkSync(path.join(srcBasePath, '.current'));
        expect(runIntegrationBuild(config, filesystemDependencies).isValid).toBe(true);
        expect(fs.readdirSync(destBasePath)).toEqual(['hashes.json']);
        expect(fs.readFileSync(path.join(destBasePath, 'hashes.json'), 'utf8')).toBe('{}');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('preserves a validated destination-root symlink while removing child links without following them', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-inte-mirror-links-'));

      try {
        const project = path.join(root, 'project');
        const staticBasePath = slash(path.join(project, 'dist/static'));
        const srcBasePath = slash(path.join(staticBasePath, 'assets'));
        const actualDestination = path.join(root, 'actual-output');
        const destBasePath = slash(path.join(root, 'output-link'));
        const keepDirectory = path.join(project, 'keep');

        fs.mkdirSync(srcBasePath, { recursive: true });
        fs.mkdirSync(actualDestination);
        fs.mkdirSync(keepDirectory);
        fs.writeFileSync(path.join(keepDirectory, 'private.txt'), 'project data\r\n');
        fs.writeFileSync(path.join(srcBasePath, 'current.txt'), 'output\r\n');
        fs.symlinkSync(actualDestination, destBasePath, 'junction');
        fs.symlinkSync(keepDirectory, path.join(destBasePath, 'obsolete-directory'), 'junction');
        fs.symlinkSync(path.join(project, 'missing'), path.join(destBasePath, 'dangling-directory'), 'junction');
        expect(validateDestinations(destBasePath, undefined, project)).toEqual({ ok: true, reasons: [] });

        expect(
          runIntegrationBuild(
            { argv: [], staticBasePath, srcBasePath, destBasePath, copyItems: [], hashItems: [], checkExistFileList: [] },
            filesystemDependencies
          ).isValid
        ).toBe(true);
        expect(fs.lstatSync(destBasePath).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(destBasePath)).toBe(fs.realpathSync(actualDestination));
        expect(fs.readdirSync(actualDestination).sort()).toEqual(['current.txt', 'hashes.json']);
        expect(fs.readFileSync(path.join(keepDirectory, 'private.txt'), 'utf8')).toBe('project data\r\n');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    const buildConfig = (overrides: Partial<IntegrationConfig> = {}): IntegrationConfig => ({
      argv: [],
      staticBasePath: '/static',
      srcBasePath: '/src',
      destBasePath: '/dest',
      copyItems: [],
      hashItems: [],
      checkExistFileList: [],
      ...overrides,
    });

    it('stops without copying or writing metadata when destination cleanup fails', () => {
      const cause = new Error('permission denied');
      const deps = buildDeps({
        readdirSync: vi.fn().mockReturnValue(['obsolete.mp4']),
        rmSync: vi.fn(() => {
          throw cause;
        }),
      });

      expect(() => runIntegrationBuild(buildConfig({ copyItems: [{ from: 'current.mp4' }] }), deps)).toThrow(cause);
      expect(deps.rmSync).toHaveBeenCalledExactlyOnceWith(path.join('/dest', 'obsolete.mp4'), { recursive: true, force: true });
      expect(deps.copyFileSync).not.toHaveBeenCalled();
      expect(deps.writeFileSync).not.toHaveBeenCalled();
    });

    it('propagates copy failures instead of returning success or writing metadata', () => {
      const cause = new Error('copy failed');
      const deps = buildDeps({
        copyFileSync: vi.fn(() => {
          throw cause;
        }),
      });

      expect(() => runIntegrationBuild(buildConfig({ copyItems: [{ from: 'current.mp4' }] }), deps)).toThrow(cause);
      expect(deps.writeFileSync).not.toHaveBeenCalled();
    });

    it('writes hashes.json to destBasePath', () => {
      const writeFileSync = vi.fn();
      const deps = buildDeps({ writeFileSync });

      runIntegrationBuild(buildConfig(), deps);

      expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('hashes.json'), expect.any(String));
    });

    it('returns validation result', () => {
      const deps = buildDeps();
      const result = runIntegrationBuild(buildConfig(), deps);

      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('missing');
    });

    it('cleans and recreates pattern directory when it exists', () => {
      const existsSync = vi.fn().mockReturnValue(true);
      const rmSync = vi.fn();
      const mkdirSync = vi.fn();
      const deps = buildDeps({ existsSync, rmSync, mkdirSync });
      const config = buildConfig({ patternPath: '/patterns' });

      runIntegrationBuild(config, deps);

      expect(rmSync).toHaveBeenCalledWith('/patterns', { recursive: true, force: true });
      expect(mkdirSync).toHaveBeenCalledWith('/patterns', { recursive: true });
    });

    it('copies pattern artifacts when patternPath is set', () => {
      const globSync = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ globSync });
      const config = buildConfig({ patternPath: '/patterns' });

      runIntegrationBuild(config, deps);

      // mkdirSync should be called for pattern path
      expect(deps.mkdirSync).toHaveBeenCalled();
    });

    it('skips pattern operations when patternPath is undefined', () => {
      const deps = buildDeps();
      const config = buildConfig({ patternPath: undefined });

      runIntegrationBuild(config, deps);

      // rmSync is only used to unlink hashes.json, never for pattern cleanup
      expect(deps.rmSync).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('hashes.json'), { force: true });
    });

    it('calls normalizeGeneratedTextFiles on destBasePath', () => {
      const globSync = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ globSync });

      runIntegrationBuild(buildConfig(), deps);

      // globSync is called for normalizeGeneratedTextFiles
      expect(globSync).toHaveBeenCalled();
    });
  });
});
