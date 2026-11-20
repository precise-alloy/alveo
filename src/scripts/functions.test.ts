import type { ModifierModel } from './functions.ts';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const importFunctionsModule = async (env: Record<string, string> = {}) => {
  vi.resetModules();
  vi.unstubAllEnvs();

  Object.entries(env).forEach(([key, value]) => {
    vi.stubEnv(key, value);
  });

  await import('./functions.ts');
};

describe('alveo/scripts/functions.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.getElementById('alveo-asset-versions')?.remove();
  });

  it('composes modifiers from base, global, style, and theme values', async () => {
    await importFunctionsModule();

    expect(
      getModifiers(
        {
          globalModifier: ['section-margin-top'],
          styleModifier: ['compact'],
          theme: 'dark',
        } as ModifierModel,
        'zzz-o-card'
      )
    ).toBe('zzz-o-card section-margin-top zzz-o-card--compact theme-dark');
  });

  it('returns only the base class when no modifiers or theme are provided', async () => {
    await importFunctionsModule();

    expect(getModifiers({} as ModifierModel, 'zzz-o-card')).toBe('zzz-o-card');
  });

  it('normalizes relative paths and preserves absolute URLs', async () => {
    await importFunctionsModule({
      BASE_URL: '/static/',
      VITE_PATH_EXTENSION: '.html',
    });

    expect(viteAbsoluteUrl('portfolio', true)).toBe('/static/portfolio.html');
    expect(viteAbsoluteUrl('/contact')).toBe('/static/contact');
    expect(viteAbsoluteUrl('https://example.com/app.js')).toBe('https://example.com/app.js');
  });

  it('handles base URLs without a trailing slash', async () => {
    await importFunctionsModule({
      BASE_URL: '/portal',
      VITE_PATH_EXTENSION: '.html',
    });

    expect(viteAbsoluteUrl('about', true)).toBe('/portal/about.html');
  });

  it('uses the document versions for late CSS and JS requests without changing explicit URLs or routes', async () => {
    await importFunctionsModule({ BASE_URL: '/site/', VITE_PATH_EXTENSION: '.html' });
    const css = '/assets/css/nested/widget.css';
    const js = '/assets/js/component.js';

    expect(viteAbsoluteUrl(css)).toBe('/site' + css);
    const data = document.createElement('script');

    data.type = 'application/json';
    data.id = 'alveo-asset-versions';
    data.textContent = JSON.stringify({
      [css]: 'abc_-12345',
      [js]: '9876543210',
      '/assets/css/empty.css': '',
      '/assets/vendors/tool.js': '1234567890',
    });
    document.head.append(data);
    expect(viteAbsoluteUrl(css)).toBe('/site' + css + '?v=abc_-12345');
    expect(viteAbsoluteUrl(js.slice(1))).toBe('/site' + js + '?v=9876543210');
    for (const path of [css + '?v=keep', css + '#fragment', '/assets/js/a.0x12345678.js', '/assets/vendors/tool.js', '/assets/css/empty.css'])
      expect(viteAbsoluteUrl(path)).toBe('/site' + path);
    expect(viteAbsoluteUrl('//cdn.test' + css)).toBe('//cdn.test' + css);
    expect(viteAbsoluteUrl(css, true)).toBe('/site' + css + '.html');
  });

  it.each(['{', 'null', '[]', '"not a map"'])('reports invalid version data %s without breaking the component', async (json) => {
    await importFunctionsModule({ BASE_URL: '/' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    document.head.insertAdjacentHTML('beforeend', `<script id="alveo-asset-versions" type="application/json">${json}</script>`);
    expect(viteAbsoluteUrl('/assets/css/widget.css')).toBe('/assets/css/widget.css');
    expect(error).toHaveBeenCalledOnce();
  });

  it('reads cookies by trimmed name and returns undefined when missing', async () => {
    await importFunctionsModule();

    vi.spyOn(document, 'cookie', 'get').mockReturnValue('feature=on; theme=dark');

    expect(window.getCookie('feature')).toBe('on');
    expect(window.getCookie('theme')).toBe('dark');
    expect(window.getCookie('missing')).toBeUndefined();
  });

  it('preserves equals signs in cookie values and ignores non-cookie segments', async () => {
    await importFunctionsModule();
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('token=a=b==; invalid; empty=');
    expect(window.getCookie('token')).toBe('a=b==');
    expect(window.getCookie('empty')).toBe('');
    expect(window.getCookie('invalid')).toBeUndefined();
  });
});
