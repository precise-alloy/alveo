// @vitest-environment node
import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { _useRenderer } from './renderer.ts';

const fixture = () => {
  const app = { use: vi.fn() };
  const render = vi.fn().mockResolvedValue({
    html: '<p>$& $$ $` $\'</p><script data-pl-require defer type="module" src="/sub/assets/js/main.js"></script>',
    styles: '/* literal $& $$ */',
  });
  const viteDevServer = {
    transformIndexHtml: vi.fn().mockImplementation(async (_url, html) => html),
    ssrLoadModule: vi.fn().mockResolvedValue({ render }),
    ssrFixStacktrace: vi.fn(),
  };

  vi.spyOn(fs, 'readFileSync').mockReturnValue('<html><head><style>/* app-styles */</style></head><body><!--app-html--></body></html>');
  _useRenderer({ app, viteDevServer, resolve: (file) => '/project/' + file, baseUrl: '/sub/', domain: 'https://cdn.test' });
  const handler = app.use.mock.calls[0]![1];
  const response = { status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), end: vi.fn() };

  return { handler, response, render, viteDevServer };
};

describe('development renderer', () => {
  it('awaits asynchronous SSR and shares literal insertion, asset relocation and dev URL rules', async () => {
    const { handler, response, render } = fixture();

    await handler({ originalUrl: '/sub/pages/a' }, response);
    expect(render).toHaveBeenCalledWith('/sub/pages/a');
    expect(response.status).toHaveBeenCalledWith(200);
    const html = response.end.mock.calls[0]![0];

    expect(html).toContain("$&amp; $$ $` $'");
    expect(html).toContain('/* literal $& $$ */');
    expect(html).toContain('https://cdn.test/sub/assets/js/main.js?v=');
    expect(html).not.toContain('<!--app-html-->');
  });
  it.each([new Error('render failed'), 'non-Error failure'])('returns HTTP 500 and logs SSR failures: %s', async (failure) => {
    const { handler, response, render, viteDevServer } = fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    render.mockRejectedValue(failure);
    await handler({ originalUrl: '/broken' }, response);
    expect(viteDevServer.ssrFixStacktrace).toHaveBeenCalledWith(expect.any(Error));
    expect(error).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.end).toHaveBeenCalledWith('Internal Server Error');
  });
});
