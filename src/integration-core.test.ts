// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { normalizePatternHtml, parseIntegrationArgs, sortHashes, validateDestinations } from './integration-core.ts';

describe('alveo/integration-core.ts', () => {
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
});
