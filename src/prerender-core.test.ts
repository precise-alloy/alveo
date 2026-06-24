// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';

import {
  hasContentHashInFileName,
  hashFileContent,
  parsePrerenderArgs,
  viteAbsoluteUrl,
  getUpdatedResourcePath,
  updateResourcePath,
  removeStyleBase,
  removeDuplicateAssets,
  ResourcePathOptions,
} from './prerender-core.js';

describe('alveo/prerender-core.ts', () => {
  describe('hasContentHashInFileName', () => {
    it('returns true for filenames with .0x[hash].ext pattern', () => {
      expect(hasContentHashInFileName('style.0xabcdef12.css')).toBe(true);
    });

    it('returns true for longer hashes within the valid range', () => {
      expect(hasContentHashInFileName('app.0x1a2b3c4d5e6f.js')).toBe(true);
    });

    it('returns false for filenames without the pattern', () => {
      expect(hasContentHashInFileName('style.css')).toBe(false);
    });

    it('returns false when the hash is too short', () => {
      expect(hasContentHashInFileName('file.0xabc.css')).toBe(false);
    });

    it('returns false when the hash is too long', () => {
      expect(hasContentHashInFileName('file.0xabcdefghijklm.css')).toBe(false);
    });

    it('is case insensitive', () => {
      expect(hasContentHashInFileName('file.0xABCDEF12.CSS')).toBe(true);
    });

    it('returns false for path without extension after hash', () => {
      expect(hasContentHashInFileName('file.0xabcdef12')).toBe(false);
    });
  });

  describe('hashFileContent', () => {
    it('returns a 10-character string', () => {
      const hash = hashFileContent('hello world');

      expect(hash).toHaveLength(10);
    });

    it('returns a base64url-compatible string', () => {
      const hash = hashFileContent('test content');

      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('returns the same hash for the same content', () => {
      expect(hashFileContent('same')).toBe(hashFileContent('same'));
    });

    it('returns different hashes for different content', () => {
      expect(hashFileContent('content A')).not.toBe(hashFileContent('content B'));
    });

    it('accepts Buffer input', () => {
      const hash = hashFileContent(Buffer.from('hello'));

      expect(hash).toHaveLength(10);
      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces consistent hash for equivalent string and Buffer', () => {
      const text = 'same content';

      expect(hashFileContent(text)).toBe(hashFileContent(Buffer.from(text)));
    });
  });

  describe('parsePrerenderArgs', () => {
    it('parses --mode from argv', () => {
      const result = parsePrerenderArgs(['node', 'script', '--mode', 'development']);

      expect(result.mode).toBe('development');
    });

    it('defaults mode to "production" when --mode is not present', () => {
      const result = parsePrerenderArgs(['node', 'script']);

      expect(result.mode).toBe('production');
    });

    it('defaults mode to "production" when --mode is last argument', () => {
      const result = parsePrerenderArgs(['node', 'script', '--mode']);

      expect(result.mode).toBe('production');
    });

    it('defaults mode to "production" when --mode value starts with "-"', () => {
      const result = parsePrerenderArgs(['node', 'script', '--mode', '--other']);

      expect(result.mode).toBe('production');
    });

    it('parses --add-hash flag as true', () => {
      const result = parsePrerenderArgs(['node', 'script', '--add-hash']);

      expect(result.addHash).toBe(true);
    });

    it('defaults addHash to false when --add-hash is not present', () => {
      const result = parsePrerenderArgs(['node', 'script']);

      expect(result.addHash).toBe(false);
    });

    it('parses both --mode and --add-hash together', () => {
      const result = parsePrerenderArgs(['node', 'script', '--mode', 'staging', '--add-hash']);

      expect(result.mode).toBe('staging');
      expect(result.addHash).toBe(true);
    });
  });

  describe('viteAbsoluteUrl', () => {
    it('returns the remain path when baseUrl is empty', () => {
      const result = viteAbsoluteUrl({ baseUrl: '' }, '/path/to/file');

      expect(result).toBe('/path/to/file');
    });

    it('prepends baseUrl without trailing slash', () => {
      const result = viteAbsoluteUrl({ baseUrl: 'https://example.com' }, '/path/to/file');

      expect(result).toBe('https://example.com/path/to/file');
    });

    it('trims trailing slash from baseUrl to avoid double slash', () => {
      const result = viteAbsoluteUrl({ baseUrl: 'https://example.com/' }, '/path/to/file');

      expect(result).toBe('https://example.com/path/to/file');
    });

    it('adds leading slash to remain if missing', () => {
      const result = viteAbsoluteUrl({ baseUrl: '' }, 'path/to/file');

      expect(result).toBe('/path/to/file');
    });

    it('appends pathExtension when addExtension is true and remain does not end with /', () => {
      const result = viteAbsoluteUrl({ baseUrl: '', pathExtension: '.html' }, '/page', true);

      expect(result).toBe('/page.html');
    });

    it('does not append pathExtension when remain ends with /', () => {
      const result = viteAbsoluteUrl({ baseUrl: '', pathExtension: '.html' }, '/page/', true);

      expect(result).toBe('/page/');
    });

    it('does not append pathExtension when addExtension is false', () => {
      const result = viteAbsoluteUrl({ baseUrl: '', pathExtension: '.html' }, '/page', false);

      expect(result).toBe('/page');
    });

    it('does not append pathExtension when addExtension is not provided', () => {
      const result = viteAbsoluteUrl({ baseUrl: '', pathExtension: '.html' }, '/page');

      expect(result).toBe('/page');
    });
  });

  describe('getUpdatedResourcePath', () => {
    const buildOptions = (overrides: Partial<ResourcePathOptions> = {}): ResourcePathOptions => ({
      addHash: false,
      baseUrl: '/',
      toAbsolute: vi.fn((value: string) => '/abs/' + value) as never,
      existsSync: vi.fn().mockReturnValue(true) as never,
      readFileSync: vi.fn().mockReturnValue(Buffer.from('file-content')) as never,
      ...overrides,
    });

    it('returns href unchanged if it does not start with "/"', () => {
      const result = getUpdatedResourcePath('relative/path.css', buildOptions());

      expect(result).toBe('relative/path.css');
    });

    it('prepends domain when domain option is provided', () => {
      const options = buildOptions({ domain: 'https://cdn.example.com' });
      // Use a path that doesn't match the hash-eligible conditions
      const result = getUpdatedResourcePath('/assets/img/photo.png', options);

      expect(result).toBe('https://cdn.example.com/assets/img/photo.png');
    });

    it('does not add hash when addHash is false', () => {
      const options = buildOptions({ addHash: false });
      const result = getUpdatedResourcePath('/style.css', options);

      expect(result).toBe('/style.css');
    });

    it('adds hash query param when addHash is true and file exists', () => {
      const options = buildOptions({
        addHash: true,
        baseUrl: '/',
        existsSync: vi.fn().mockReturnValue(true) as never,
        readFileSync: vi.fn().mockReturnValue(Buffer.from('css content')) as never,
      });

      const result = getUpdatedResourcePath('/style.css', options);

      expect(result).toMatch(/\/style\.css\?v=.+/);
    });

    it('skips hashing for files in assets/vendors/ directory', () => {
      const options = buildOptions({ addHash: true });
      const result = getUpdatedResourcePath('/assets/vendors/lib.js', options);

      expect(result).toBe('/assets/vendors/lib.js');
    });

    it('skips hashing for extensions not in the supported list', () => {
      const options = buildOptions({ addHash: true });
      const result = getUpdatedResourcePath('/image.png', options);

      expect(result).toBe('/image.png');
    });

    it('skips hashing for files with content hash already in name', () => {
      const options = buildOptions({ addHash: true });
      const result = getUpdatedResourcePath('/app.0xabcdef12.js', options);

      expect(result).toBe('/app.0xabcdef12.js');
    });

    it('calls onMissingPath when file does not exist and is not mock-api.js', () => {
      const onMissingPath = vi.fn();
      const options = buildOptions({
        addHash: true,
        existsSync: vi.fn().mockReturnValue(false) as never,
        onMissingPath,
      });

      getUpdatedResourcePath('/app.js', options);

      expect(onMissingPath).toHaveBeenCalled();
    });

    it('does not call onMissingPath for mock-api.js', () => {
      const onMissingPath = vi.fn();
      const options = buildOptions({
        addHash: true,
        existsSync: vi.fn().mockReturnValue(false) as never,
        onMissingPath,
      });

      getUpdatedResourcePath('/mock-api.js', options);

      expect(onMissingPath).not.toHaveBeenCalled();
    });

    it('hashes supported extensions: .css, .ico, .js, .webmanifest, .svg', () => {
      const extensions = ['.css', '.ico', '.js', '.webmanifest', '.svg'];

      extensions.forEach((ext) => {
        const options = buildOptions({
          addHash: true,
          existsSync: vi.fn().mockReturnValue(true) as never,
          readFileSync: vi.fn().mockReturnValue(Buffer.from('content')) as never,
        });

        const result = getUpdatedResourcePath(`/file${ext}`, options);

        expect(result).toMatch(/\?v=.+/, `Expected hash for extension ${ext}`);
      });
    });
  });

  describe('updateResourcePath', () => {
    it('updates href attributes on matching elements', () => {
      const $ = cheerio.load('<html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>');
      const options: ResourcePathOptions = {
        addHash: true,
        baseUrl: '/',
        toAbsolute: (value: string) => '/abs/' + value,
        existsSync: () => true,
        readFileSync: () => Buffer.from('css content'),
      };

      updateResourcePath($, 'link', 'href', options);

      const href = $('link').attr('href');

      expect(href).toMatch(/\/style\.css\?v=.+/);
    });

    it('does not modify elements without the specified attribute', () => {
      const $ = cheerio.load('<html><head><link rel="stylesheet"></head><body></body></html>');
      const options: ResourcePathOptions = {
        addHash: true,
        baseUrl: '/',
        toAbsolute: (value: string) => '/abs/' + value,
        existsSync: () => true,
        readFileSync: () => Buffer.from('content'),
      };

      updateResourcePath($, 'link', 'href', options);

      expect($('link').attr('href')).toBeUndefined();
    });

    it('does not modify the attribute when path is unchanged', () => {
      const $ = cheerio.load('<html><head><link rel="stylesheet" href="relative.css"></head><body></body></html>');
      const options: ResourcePathOptions = {
        addHash: false,
        baseUrl: '/',
        toAbsolute: (value: string) => '/abs/' + value,
        existsSync: () => true,
        readFileSync: () => Buffer.from('content'),
      };

      updateResourcePath($, 'link', 'href', options);

      expect($('link').attr('href')).toBe('relative.css');
    });
  });

  describe('removeStyleBase', () => {
    it('removes link elements whose href contains "style-base"', () => {
      const $ = cheerio.load(
        '<html><head><link rel="stylesheet" href="/assets/css/style-base.css"><link rel="stylesheet" href="/assets/css/main.css"></head><body></body></html>'
      );

      removeStyleBase($);

      expect($('link[rel="stylesheet"]')).toHaveLength(1);
      expect($('link[rel="stylesheet"]').attr('href')).toBe('/assets/css/main.css');
    });

    it('does not remove stylesheets without "style-base" in href', () => {
      const $ = cheerio.load(
        '<html><head><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/other.css"></head><body></body></html>'
      );

      removeStyleBase($);

      expect($('link[rel="stylesheet"]')).toHaveLength(2);
    });

    it('handles no stylesheets gracefully', () => {
      const $ = cheerio.load('<html><head></head><body></body></html>');

      removeStyleBase($);

      expect($('link[rel="stylesheet"]')).toHaveLength(0);
    });

    it('removes multiple style-base links', () => {
      const $ = cheerio.load(
        '<html><head><link rel="stylesheet" href="/style-base.css"><link rel="stylesheet" href="/other-style-base.css"></head><body></body></html>'
      );

      removeStyleBase($);

      expect($('link[rel="stylesheet"]')).toHaveLength(0);
    });
  });

  describe('removeDuplicateAssets', () => {
    it('removes duplicate script elements with the same src', () => {
      const $ = cheerio.load(
        '<html><head></head><body><script src="/app.js" data-pl-require="true"></script><script src="/app.js" data-pl-require="true"></script></body></html>'
      );
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      // First one should be moved to head, second should be removed
      expect(paths).toEqual(['/app.js']);
    });

    it('skips elements with data-pl-inplace="true"', () => {
      const $ = cheerio.load(
        '<html><head></head><body><script src="/inline.js" data-pl-inplace="true"></script><script src="/app.js"></script></body></html>'
      );
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      expect(paths).toEqual(['/app.js']);
    });

    it('skips elements without the specified attribute', () => {
      const $ = cheerio.load('<html><head></head><body><script>inline code</script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      expect(paths).toEqual([]);
    });

    it('removes data-pl-require attribute from kept elements', () => {
      const $ = cheerio.load('<html><head></head><body><script src="/app.js" data-pl-require="true"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/app.js"]');

      expect(script.attr('data-pl-require')).toBeUndefined();
    });

    it('removes defer attribute from module scripts with defer=""', () => {
      const $ = cheerio.load('<html><head></head><body><script type="module" src="/app.js" defer=""></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/app.js"]');

      expect(script.attr('defer')).toBeUndefined();
    });

    it('removes defer from module scripts with defer="defer"', () => {
      const $ = cheerio.load('<html><head></head><body><script type="module" src="/app.js" defer="defer"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/app.js"]');

      expect(script.attr('defer')).toBeUndefined();
    });

    it('removes defer from module scripts with defer="true"', () => {
      const $ = cheerio.load('<html><head></head><body><script type="module" src="/app.js" defer="true"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/app.js"]');

      expect(script.attr('defer')).toBeUndefined();
    });

    it('moves kept elements to the head', () => {
      const $ = cheerio.load('<html><head></head><body><script src="/app.js"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      expect($('head script[src="/app.js"]')).toHaveLength(1);
    });

    it('skips elements whose specified attribute is empty string', () => {
      const $ = cheerio.load('<html><head></head><body><script src=""></script><script src="/app.js"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      // Only the non-empty src should be tracked
      expect(paths).toEqual(['/app.js']);
    });

    it('does not touch defer on module scripts when defer attribute is absent', () => {
      const $ = cheerio.load('<html><head></head><body><script type="module" src="/mod.js"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/mod.js"]');

      expect(script).toHaveLength(1);
      expect(script.attr('defer')).toBeUndefined();
    });

    it('removes defer from module scripts with data-pl-require and defer="" (empty string)', () => {
      const $ = cheerio.load('<html><head></head><body><script type="module" defer="" data-pl-require src="/x.js"></script></body></html>');
      const paths: string[] = [];

      removeDuplicateAssets($, 'script[src]', 'src', paths);

      const script = $('head script[src="/x.js"]');

      expect(script).toHaveLength(1);
      expect(script.attr('defer')).toBeUndefined();
      expect(script.attr('data-pl-require')).toBeUndefined();
      expect(paths).toEqual(['/x.js']);
    });
  });
});
