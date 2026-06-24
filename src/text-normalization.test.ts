// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  isTextLikeContent,
  isTextLikePath,
  normalizeSourceMapLineEndings,
  normalizeTextFileContent,
  normalizeTextLikeContent,
  normalizeTextLineEndings,
} from './text-normalization.js';

describe('alveo/text-normalization.ts', () => {
  describe('normalizeTextLineEndings', () => {
    it('normalizes Windows CRLF line endings to LF', () => {
      expect(normalizeTextLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc');
    });

    it('normalizes legacy Mac CR line endings to LF', () => {
      expect(normalizeTextLineEndings('a\rb\rc')).toBe('a\nb\nc');
    });

    it('normalizes mixed line endings to LF', () => {
      expect(normalizeTextLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    });

    it('leaves LF-only text unchanged', () => {
      const text = 'a\nb\nc\n';

      expect(normalizeTextLineEndings(text)).toBe(text);
    });

    it('handles empty strings', () => {
      expect(normalizeTextLineEndings('')).toBe('');
    });
  });

  describe('isTextLikePath', () => {
    it('returns true for supported text file extensions', () => {
      const textExtensions = [
        'css',
        'cjs',
        'htm',
        'html',
        'js',
        'json',
        'jsx',
        'map',
        'md',
        'mjs',
        'scss',
        'svg',
        'ts',
        'tsx',
        'txt',
        'webmanifest',
        'xml',
      ];

      textExtensions.forEach((ext) => {
        expect(isTextLikePath(`/assets/file.${ext}`)).toBe(true);
      });
    });

    it('returns false for non-text file extensions', () => {
      expect(isTextLikePath('/assets/images/photo.png')).toBe(false);
      expect(isTextLikePath('/assets/images/photo.jpg')).toBe(false);
      expect(isTextLikePath('/assets/fonts/font.woff2')).toBe(false);
      expect(isTextLikePath('/assets/video.mp4')).toBe(false);
    });

    it('detects text-like paths with query strings', () => {
      expect(isTextLikePath('/assets/images/icon.svg?v=abc')).toBe(true);
    });

    it('detects text-like paths with hash fragments', () => {
      expect(isTextLikePath('/assets/images/icon.svg#shape')).toBe(true);
    });

    it('detects text-like paths with both query strings and hashes', () => {
      expect(isTextLikePath('/assets/images/icon.svg?v=abc#shape')).toBe(true);
    });

    it('is case-insensitive for extensions', () => {
      expect(isTextLikePath('/assets/FILE.CSS')).toBe(true);
      expect(isTextLikePath('/assets/FILE.Js')).toBe(true);
    });

    it('matches .map extension for source map files', () => {
      expect(isTextLikePath('/assets/css/site.css.map')).toBe(true);
    });
  });

  describe('isTextLikeContent', () => {
    it('returns true for string content', () => {
      expect(isTextLikeContent('plain text')).toBe(true);
    });

    it('returns true for empty buffers', () => {
      expect(isTextLikeContent(Buffer.alloc(0))).toBe(true);
    });

    it('returns true for buffers with valid UTF-8 text', () => {
      expect(isTextLikeContent(Buffer.from('hello world\n'))).toBe(true);
    });

    it('returns true for buffers with CRLF text', () => {
      expect(isTextLikeContent(Buffer.from('custom text\r\n'))).toBe(true);
    });

    it('returns false for buffers containing null bytes', () => {
      expect(isTextLikeContent(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(false);
    });

    it('returns false for buffers with many disallowed control bytes', () => {
      expect(isTextLikeContent(Buffer.from([1, 2, 3, 4]))).toBe(false);
    });

    it('allows tab (0x09), newline (0x0A), form feed (0x0C), and CR (0x0D) control chars', () => {
      expect(isTextLikeContent(Buffer.from([0x09, 0x0a, 0x0c, 0x0d, 65, 66]))).toBe(true);
    });
  });

  describe('normalizeSourceMapLineEndings', () => {
    it('normalizes CRLF in sourcesContent entries', () => {
      const sourceMap = JSON.stringify({ version: 3, sourcesContent: ['a\r\nb', null], mappings: '' });
      const expected = JSON.stringify({ version: 3, sourcesContent: ['a\nb', null], mappings: '' });

      expect(normalizeSourceMapLineEndings(sourceMap)).toBe(expected);
    });

    it('returns original text when sourcesContent is already normalized', () => {
      const alreadyNormalized = JSON.stringify({ version: 3, sourcesContent: ['a\nb'], mappings: '' });

      expect(normalizeSourceMapLineEndings(alreadyNormalized)).toBe(alreadyNormalized);
    });

    it('returns original text when sourcesContent is not an array', () => {
      const noSourcesContent = JSON.stringify({ version: 3, mappings: '' });

      expect(normalizeSourceMapLineEndings(noSourcesContent)).toBe(noSourcesContent);
    });

    it('returns original text for invalid JSON', () => {
      expect(normalizeSourceMapLineEndings('{not-json')).toBe('{not-json');
    });

    it('leaves non-string sourcesContent entries unchanged', () => {
      const sourceMap = JSON.stringify({ version: 3, sourcesContent: [null, 42, 'a\r\nb'], mappings: '' });
      const result = JSON.parse(normalizeSourceMapLineEndings(sourceMap));

      expect(result.sourcesContent).toEqual([null, 42, 'a\nb']);
    });
  });

  describe('normalizeTextFileContent', () => {
    it('normalizes physical line endings for regular text files', () => {
      expect(normalizeTextFileContent('/app.js', 'const x = 1;\r\n')).toBe('const x = 1;\n');
    });

    it('normalizes both physical line endings and source map content for .map files', () => {
      const sourceMap = '{"version":3,"sourcesContent":["a\\r\\nb"],"mappings":""}\r\n';

      expect(normalizeTextFileContent('/assets/js/app.js.map', sourceMap)).toBe('{"version":3,"sourcesContent":["a\\nb"],"mappings":""}');
    });

    it('detects .map extension with query strings', () => {
      const sourceMap = '{"version":3,"sourcesContent":["a\\r\\nb"],"mappings":""}\r\n';

      expect(normalizeTextFileContent('/app.js.map?v=123', sourceMap)).toBe('{"version":3,"sourcesContent":["a\\nb"],"mappings":""}');
    });

    it('detects .map extension with hash fragments', () => {
      const sourceMap = '{"version":3,"sourcesContent":["a\\r\\nb"],"mappings":""}\r\n';

      expect(normalizeTextFileContent('/app.js.map#x', sourceMap)).toBe('{"version":3,"sourcesContent":["a\\nb"],"mappings":""}');
    });
  });

  describe('normalizeTextLikeContent', () => {
    it('normalizes text-like Buffer content by extension', () => {
      expect(normalizeTextLikeContent('/assets/images/icon.svg', Buffer.from('<svg>\r\n</svg>\r\n'))).toBe('<svg>\n</svg>\n');
    });

    it('normalizes string content by extension', () => {
      expect(normalizeTextLikeContent('/assets/js/main.js', 'const value = 1;\r\n')).toBe('const value = 1;\n');
    });

    it('normalizes content when the extension is not text-like but content is text-like', () => {
      expect(normalizeTextLikeContent('/assets/custom/template', Buffer.from('content\r\n'))).toBe('content\n');
    });

    it('leaves binary assets untouched when both path and content are non-text', () => {
      const binary = Buffer.from([0, 1, 2, 3]);

      expect(normalizeTextLikeContent('/assets/images/photo.png', binary)).toBe(binary);
    });

    it('normalizes string content regardless of path', () => {
      expect(normalizeTextLikeContent('/assets/images/photo.png', 'text\r\n')).toBe('text\n');
    });
  });
});
