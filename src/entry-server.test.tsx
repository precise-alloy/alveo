// @vitest-environment node
import ReactDOMServer from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { render, renderConfig, routesToPrerender } from './entry-server.tsx';

vi.mock('./routes.ts', () => ({ routesToPrerender: [{ route: '/pages/home', name: 'home' }] }));
vi.mock('./app.tsx', () => ({ App: () => <p>Server output</p> }));

describe('SSR entry', () => {
  it('renders in a real Node environment without creating window', () => {
    expect(typeof window).toBe('undefined');
    expect(render('/pages/home')).toEqual({ html: '<p>Server output</p>', styles: '' });
    expect(typeof window).toBe('undefined');
    expect(routesToPrerender).toEqual([{ route: '/pages/home', name: 'home' }]);
    expect(renderConfig).toMatchObject({ baseUrl: '/', pathExtension: '' });
  });
  it('exports the resolved base and extension for the prerender process', async () => {
    vi.stubEnv('BASE_URL', '/override/');
    vi.stubEnv('VITE_PATH_EXTENSION', '.html');
    try {
      vi.resetModules();
      const { renderConfig } = await import('./entry-server.tsx');

      expect(renderConfig).toMatchObject({ baseUrl: '/override/', pathExtension: '.html' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('preserves route and original error instead of returning empty HTML', () => {
    const cause = new Error('component failed');

    vi.spyOn(ReactDOMServer, 'renderToString').mockImplementationOnce(() => {
      throw cause;
    });
    try {
      render('/pages/broken');
      throw new Error('Expected SSR to fail');
    } catch (error) {
      expect(error).toMatchObject({ message: 'SSR failed for route "/pages/broken".', cause });
    }
  });
});
