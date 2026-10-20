// @vitest-environment node
import type { AlveoContext } from './types.ts';

import fs from 'node:fs';

import { glob } from 'glob';
import { afterEach, describe, expect, it, vi } from 'vitest';

import options, { isMockApiEnabled } from './options.ts';
import transformIndexHtml from './transform-index-html.ts';

vi.mock('glob', () => ({ glob: { sync: vi.fn() } }));
const context = (mode = 'development'): AlveoContext => ({
  projectRoot: '/project',
  packageRoot: '/package',
  srcRoot: '/project/src',
  outDir: '/project/dist',
  mode,
  env: {},
});
const plugin = (ctx = context()) => options(ctx) as { options: (options: { input?: string | Record<string, string> }) => unknown };
const htmlPlugin = (base: string, ctx?: AlveoContext) =>
  transformIndexHtml(base, ctx) as {
    configResolved: (config: { base: string }) => void;
    transformIndexHtml: (html: string) => string;
  };

afterEach(() => vi.unstubAllEnvs());

describe('optional mocks and Vite entry discovery', () => {
  it('enables mocks only when a non-production consumer has handlers', () => {
    vi.mocked(glob.sync).mockReturnValue([]);
    expect(isMockApiEnabled(context())).toBe(false);
    vi.mocked(glob.sync).mockReturnValue(['/project/src/mocks/handlers.ts']);
    expect(isMockApiEnabled(context('eshn'))).toBe(true);
    expect(isMockApiEnabled(context('production'))).toBe(false);
  });
  it('discovers entries once from the correct framework source and preserves SSR input', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.mocked(glob.sync).mockReturnValue(['/project/src/assets/scripts/MyEntry.entry.ts']);
    const hook = plugin();
    const input: { input?: string | Record<string, string> } = {};

    hook.options(input);
    expect(input.input).toEqual({ index: '/project/index.html', 'my-entry': '/project/src/assets/scripts/MyEntry.entry.ts' });
    expect(glob.sync).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('/src/scripts/')]));
    const ssr = { input: '/package/dist/entry-server.js' };

    expect(hook.options(ssr)).toBe(ssr);
  });
  it('omits HTML in script-only mode, uses packaged entries, and excludes missing mocks', () => {
    vi.stubEnv('scriptOnly', 'true');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.mocked(glob.sync).mockImplementation((pattern) => (typeof pattern === 'string' ? [] : ['/package/dist/scripts/mock-api.entry.js']));
    const input: { input?: Record<string, string> } = {};

    plugin().options(input);
    expect(input.input).toEqual({});
    expect(glob.sync).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('/dist/scripts/')]));
  });
  it('includes custom-mode mocks when configured and rejects duplicate entry names', () => {
    vi.mocked(glob.sync).mockImplementation((pattern) =>
      typeof pattern === 'string' ? ['/project/src/mocks/handlers.ts'] : ['/package/dist/scripts/mock-api.entry.js']
    );
    const input: { input?: Record<string, string> } = {};

    plugin(context('eshn')).options(input);
    expect(input.input).toHaveProperty('mock-api');
    vi.mocked(glob.sync).mockReturnValue(['/a/main.entry.ts', '/b/main.entry.ts']);
    expect(() => plugin().options({})).toThrow('Duplicate script entry');
  });
  it('normalizes configured and resolved bases and removes only disabled framework mock tags', () => {
    const hook = htmlPlugin('/subpath');

    expect(hook.transformIndexHtml('<img src="#__BASE_URL__/assets/a.svg">')).toContain('/subpath/assets/a.svg');
    hook.configResolved({ base: '/other/' });
    expect(hook.transformIndexHtml('#__BASE_URL__/file')).toBe('/other/file');
    expect(htmlPlugin('/$&').transformIndexHtml('#__BASE_URL__/file')).toBe('/$&/file');
    const html = '<script type="module" src="#__BASE_URL__/assets/js/mock-api.js"></script><script src="#__BASE_URL__/assets/js/main.js"></script>';
    const disabled = htmlPlugin('/subpath', context('production')).transformIndexHtml(html);

    expect(disabled).not.toContain('mock-api');
    expect(disabled).toContain('/subpath/assets/js/main.js');
    vi.mocked(glob.sync).mockReturnValue(['/project/src/mocks/handlers.ts']);
    expect(htmlPlugin('/subpath', context('eshn')).transformIndexHtml(html)).toContain('mock-api');
  });
  it('does not rewrite inline script data and handles queries or unquoted src attributes', () => {
    const hook = htmlPlugin('/', context('production'));

    expect(hook.transformIndexHtml('<p>no mocks</p>')).toBe('<p>no mocks</p>');
    const inline = '<script type="application/json">{"example":"<script src=\\"/assets/js/mock-api.js\\">"}</script>';

    expect(hook.transformIndexHtml(inline)).toBe(inline);
    expect(hook.transformIndexHtml('<script src=/assets/js/mock-api.js?v=1></script><script src=""></script>')).not.toContain('mock-api.js');
  });
});
