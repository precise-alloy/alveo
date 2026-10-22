import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReactSection, RequireCss, RequireJs } from './helpers.tsx';

beforeEach(() => {
  vi.stubGlobal('viteAbsoluteUrl', (value: string) => '/subpath' + value);
});
afterEach(() => vi.unstubAllGlobals());

describe('packaged component helpers', () => {
  it.each([
    ['main', '/subpath/assets/js/main.js'],
    ['vendors/vendor', '/subpath/assets/vendors/vendor.js'],
    ['https://example.test/app.js', 'https://example.test/app.js'],
  ])('resolves script %s without consumer helper imports', (path, expected) => {
    const html = renderToStaticMarkup(<RequireJs defer path={path} />);

    expect(html).toContain(`src="${expected}"`);
    expect(html).toContain('type="module"');
    expect(html).toContain('data-pl-require');
  });

  it('preserves script flags', () => {
    const html = renderToStaticMarkup(<RequireJs async inplace defer={false} path="main" type="text/javascript" />);

    expect(html).toContain('data-pl-inplace="true"');
    expect(html).toContain('type="text/javascript"');
    expect(html).toContain('async=""');
    expect(html).not.toContain('defer=');
  });

  it.each([
    ['style', '/subpath/assets/css/style.css'],
    ['vendors/vendor', '/subpath/assets/vendors/vendor.css'],
    ['https://example.test/a.css', 'https://example.test/a.css'],
  ])('resolves stylesheet %s', (path, expected) => {
    expect(renderToStaticMarkup(<RequireCss path={path} />)).toContain(`href="${expected}"`);
  });

  it('preserves custom link relations', () => {
    expect(renderToStaticMarkup(<RequireCss path="style" rel="modulepreload" />)).toContain('rel="modulepreload"');
  });

  it.each([undefined, '', 'root', ['root', 'page']])('renders JSON and optional styles %j', (css) => {
    document.body.innerHTML = renderToStaticMarkup(<ReactSection css={css} data={{ label: 'Example' }} type="root" />);
    expect(JSON.parse(document.querySelector('script')!.textContent!)).toEqual({ label: 'Example' });
    expect(document.querySelectorAll('link')).toHaveLength(!css ? 0 : typeof css === 'string' ? 1 : 2);
  });

  it('prevents raw-text script breakout while round-tripping all JSON values', () => {
    const data = { text: '</script><div id="injected">x</div><!-- & "$&"\u2028\u2029', count: 2 };
    const html = renderToStaticMarkup(<ReactSection data={data} type="root" />);

    document.body.innerHTML = html;
    expect(document.querySelector('#injected')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(JSON.parse(document.querySelector('script')!.textContent!)).toEqual(data);
    expect(html).toContain('\\u003c');
  });

  it('reports unserializable payloads instead of producing invalid JSON', () => {
    expect(() => renderToStaticMarkup(<ReactSection data={undefined} type="root" />)).toThrow('JSON-serializable');
    const cyclic: { self?: unknown } = {};

    cyclic.self = cyclic;
    expect(() => renderToStaticMarkup(<ReactSection data={cyclic} type="root" />)).toThrow(TypeError);
  });
});
