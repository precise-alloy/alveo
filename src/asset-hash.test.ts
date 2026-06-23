// @vitest-environment node

import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import {
  ASSET_HASH_REGEX,
  AssetHashDependencies,
  createAppendAssetHash,
  createDefaultAssetHashDependencies,
  rewriteAssetHashes,
} from './asset-hash.js';

const buildDeps = (overrides: Partial<AssetHashDependencies> = {}): AssetHashDependencies => ({
  existsSync: vi.fn().mockReturnValue(true) as never,
  readFileSync: vi.fn().mockReturnValue(Buffer.from('content')) as never,
  hash: vi.fn().mockReturnValue('h1') as never,
  resolveAssetPath: vi.fn((url: string) => '/abs' + url) as never,
  cache: {},
  logMissing: vi.fn(),
  ...overrides,
});

describe('alveo/asset-hash.ts', () => {
  describe('ASSET_HASH_REGEX', () => {
    it('matches every supported extension', () => {
      const extensions = ['svg', 'ttf', 'otf', 'woff', 'woff2', 'png', 'webp', 'jpg', 'jpeg', 'gif'];

      extensions.forEach((ext) => {
        ASSET_HASH_REGEX.lastIndex = 0;
        expect(`/assets/img/x.${ext}`.match(ASSET_HASH_REGEX)).toEqual([`/assets/img/x.${ext}`]);
      });
    });

    it('does not match unsupported extensions', () => {
      ASSET_HASH_REGEX.lastIndex = 0;
      expect('/assets/clip.mp4'.match(ASSET_HASH_REGEX)).toBeNull();
    });
  });

  describe('createAppendAssetHash', () => {
    it('appends ?v=<hash> for an existing asset and caches the result', () => {
      const cache: Record<string, string> = {};
      const readFileSync = vi.fn().mockReturnValue(Buffer.from('body')) as never;
      const hash = vi.fn().mockReturnValue('abc') as never;
      const append = createAppendAssetHash(buildDeps({ cache, readFileSync, hash }));

      expect(append('/assets/img/a.png')).toBe('/assets/img/a.png?v=abc');
      expect(cache['/assets/img/a.png']).toBe('abc');

      // Second call must hit the cache: no further fs / hash work happens.
      expect(append('/assets/img/a.png')).toBe('/assets/img/a.png?v=abc');
      expect(readFileSync).toHaveBeenCalledTimes(1);
      expect(hash).toHaveBeenCalledTimes(1);
    });

    it('returns original URL if it already has a query string', () => {
      const existsSync = vi.fn() as never;
      const append = createAppendAssetHash(buildDeps({ existsSync }));

      expect(append('/assets/img/a.png?v=manual')).toBe('/assets/img/a.png?v=manual');
      expect(existsSync).not.toHaveBeenCalled();
    });

    it('returns cached hash if available', () => {
      const cache: Record<string, string> = { '/assets/img/a.png': 'cached' };
      const readFileSync = vi.fn() as never;
      const append = createAppendAssetHash(buildDeps({ cache, readFileSync }));

      expect(append('/assets/img/a.png')).toBe('/assets/img/a.png?v=cached');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('calls logMissing and returns original URL when the asset is missing on disk', () => {
      const logMissing = vi.fn();
      const append = createAppendAssetHash(
        buildDeps({
          existsSync: vi.fn().mockReturnValue(false) as never,
          logMissing,
        })
      );

      expect(append('/assets/img/missing.png')).toBe('/assets/img/missing.png');
      expect(logMissing).toHaveBeenCalledWith('/abs/assets/img/missing.png');
    });

    it('hashes text assets after LF normalization', () => {
      const hash = vi.fn((content: Buffer | string) => (content === '<svg>\n</svg>\n' ? 'lfhash' : 'rawhash')) as never;
      const append = createAppendAssetHash(
        buildDeps({
          readFileSync: vi.fn().mockReturnValue(Buffer.from('<svg>\r\n</svg>\r\n')) as never,
          hash,
        })
      );

      expect(append('/assets/images/icon.svg')).toBe('/assets/images/icon.svg?v=lfhash');
      expect(hash).toHaveBeenCalledWith('<svg>\n</svg>\n');
    });

    it('keeps binary asset bytes unchanged when hashing', () => {
      const content = Buffer.from([0, 1, 2, 3]);
      const hash = vi.fn().mockReturnValue('binaryhash') as never;
      const append = createAppendAssetHash(
        buildDeps({
          readFileSync: vi.fn().mockReturnValue(content) as never,
          hash,
        })
      );

      expect(append('/assets/images/photo.png')).toBe('/assets/images/photo.png?v=binaryhash');
      expect(hash).toHaveBeenCalledWith(content);
    });
  });

  describe('rewriteAssetHashes', () => {
    it('rewrites every matching URL in a CSS payload using injected dependencies', () => {
      const css = "body { background: url('/assets/img/a.png'); src: url('/assets/fonts/b.woff2') format('woff2'); }";
      const out = rewriteAssetHashes(
        css,
        buildDeps({
          hash: vi.fn().mockReturnValueOnce('h1').mockReturnValueOnce('h2') as never,
        })
      );

      expect(out).toContain('/assets/img/a.png?v=h1');
      expect(out).toContain('/assets/fonts/b.woff2?v=h2');
    });

    it('returns input unchanged when no asset URLs match', () => {
      expect(rewriteAssetHashes('body { color: red; }', buildDeps())).toBe('body { color: red; }');
    });
  });

  describe('createDefaultAssetHashDependencies', () => {
    it('returns an object with the expected shape', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(deps).toHaveProperty('existsSync');
      expect(deps).toHaveProperty('readFileSync');
      expect(deps).toHaveProperty('hash');
      expect(deps).toHaveProperty('resolveAssetPath');
      expect(deps).toHaveProperty('cache');
      expect(deps).toHaveProperty('logMissing');
    });

    it('has an empty cache object', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(deps.cache).toEqual({});
    });

    it('resolveAssetPath resolves relative to public/ within the project root', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');
      const resolved = deps.resolveAssetPath('/assets/img/logo.png');

      expect(resolved).toContain('project/root/public/assets/img/logo.png');
      expect(resolved).not.toContain('\\');
    });

    it('resolveAssetPath returns forward-slash normalized paths', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');
      const resolved = deps.resolveAssetPath('/assets/fonts/font.woff2');

      expect(resolved).not.toContain('\\');
    });

    it('existsSync is a function', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(typeof deps.existsSync).toBe('function');
    });

    it('readFileSync is a function', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(typeof deps.readFileSync).toBe('function');
    });

    it('hash is a function', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(typeof deps.hash).toBe('function');
    });

    it('logMissing is a function', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(typeof deps.logMissing).toBe('function');
    });

    it('each call returns a fresh cache object', () => {
      const deps1 = createDefaultAssetHashDependencies('/project/root');
      const deps2 = createDefaultAssetHashDependencies('/project/root');

      expect(deps1.cache).not.toBe(deps2.cache);
    });

    it('readFileSync reads a real file from disk', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-hash-test-'));

      try {
        const tempFile = path.join(tempDir, 'test.txt');

        fs.writeFileSync(tempFile, 'hello asset hash');
        const deps = createDefaultAssetHashDependencies(tempDir);
        const content = deps.readFileSync(tempFile);

        expect(Buffer.isBuffer(content)).toBe(true);
        expect(content.toString()).toBe('hello asset hash');
      } finally {
        fs.rmSync(tempDir, { force: true, recursive: true });
      }
    });

    it('logMissing calls console.error with the expected message', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const deps = createDefaultAssetHashDependencies('/project/root');

        deps.logMissing('/abs/path/missing.png');
        expect(spy).toHaveBeenCalledWith('File not found: /abs/path/missing.png');
      } finally {
        spy.mockRestore();
      }
    });

    it('hash returns a string hash for content', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');
      const result = deps.hash('some content');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('existsSync returns false for a non-existent path', () => {
      const deps = createDefaultAssetHashDependencies('/project/root');

      expect(deps.existsSync('/definitely/does/not/exist/file.txt')).toBe(false);
    });
  });
});
