// @vitest-environment node
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';

import { createViteDevServer } from './create-vite-dev-server.ts';
import { _useRenderer } from './renderer.ts';
import { assertDevelopmentMode, createServer, startServer } from './create-server.ts';
import { initServer } from './server.ts';

const { app, staticFiles } = vi.hoisted(() => ({
  app: { use: vi.fn(), listen: vi.fn() },
  staticFiles: vi.fn().mockReturnValue('static-middleware'),
}));

vi.mock('express', () => ({ default: Object.assign(() => app, { static: staticFiles }) }));
vi.mock('vite', () => ({ loadEnv: vi.fn().mockReturnValue({}) }));
vi.mock('./create-vite-dev-server.ts', () => ({ createViteDevServer: vi.fn() }));
vi.mock('./renderer.ts', () => ({ _useRenderer: vi.fn() }));
const vite = { middlewares: 'vite-middleware', config: { base: '/sub/' }, close: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.mocked(loadEnv).mockReturnValue({});
  vi.mocked(createViteDevServer).mockResolvedValue(vite as never);
  app.use.mockClear();
  app.listen.mockReset();
  app.listen.mockImplementation((_port, ready) => {
    const server = new EventEmitter();

    queueMicrotask(ready);

    return server;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('development-only server', () => {
  it('rejects production mode and production NODE_ENV explicitly', () => {
    expect(() => assertDevelopmentMode('production')).toThrow('development-only');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertDevelopmentMode('development')).toThrow('development-only');
  });
  it('passes explicit mode/base/ports to Vite and mounts watched assets under the base', async () => {
    vi.mocked(loadEnv).mockReturnValue({ VITE_DOMAIN: 'https://dev.test' });
    await createServer({ root: '/project', mode: 'eshn', isTest: false, port: 5000, hmrPort: 5001, baseUrl: '/sub' });
    expect(createViteDevServer).toHaveBeenCalledWith({
      root: '/project',
      mode: 'eshn',
      isTest: false,
      hmrPort: 5001,
      baseUrl: '/sub',
    });
    expect(app.use).toHaveBeenCalledWith('/assets', 'static-middleware');
    expect(_useRenderer).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: '/sub/', domain: 'https://dev.test' }));
  });
  it('awaits listening and closes Vite if startup fails', async () => {
    const props = { root: '/project', mode: 'development', isTest: false, port: 5000 };

    await expect(startServer(props)).resolves.toBeInstanceOf(EventEmitter);
    app.listen.mockImplementationOnce(() => {
      const server = new EventEmitter();

      queueMicrotask(() => server.emit('error', new Error('port busy')));

      return server;
    });
    await expect(startServer(props)).rejects.toThrow('port busy');
    expect(vite.close).toHaveBeenCalled();
  });
  it('uses defaults, environment ports, explicit ports and test mode without mutating argv', async () => {
    const argv = [...process.argv];

    await initServer('/project');
    expect(app.listen).toHaveBeenLastCalledWith(5000, expect.any(Function));
    vi.mocked(loadEnv).mockReturnValue({ VITE_PORT: '5005', VITE_BASE_URL: '/env/' });
    await initServer('/project', { mode: 'eshn' });
    expect(app.listen).toHaveBeenLastCalledWith(5005, expect.any(Function));
    await initServer('/project', { port: '65535' });
    expect(createViteDevServer).toHaveBeenLastCalledWith(expect.objectContaining({ hmrPort: undefined }));
    expect(process.argv).toEqual(argv);
    vi.stubEnv('NODE_ENV', 'test');
    expect(await initServer('/project')).toBeUndefined();
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(loadEnv).mockReturnValue({ VITE_TEST_BUILD: '1' });
    expect(await initServer('/project')).toBeUndefined();
    await expect(initServer('/project', { port: 'oops' })).rejects.toThrow('--port');
  });
});
