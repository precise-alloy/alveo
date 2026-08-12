import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { createViteDevServer } from './create-vite-dev-server.ts';

vi.mock('vite', () => ({
  createServer: vi.fn(),
}));

describe('createViteDevServer', () => {
  beforeEach(() => {
    vi.mocked(createServer).mockReset();
  });

  it('configures the development WebSocket port without deprecated HMR options', async () => {
    const viteDevServer = {};
    vi.mocked(createServer).mockResolvedValue(viteDevServer as never);

    await expect(createViteDevServer({
      root: '/project',
      baseUrl: '/assets/',
      hmrPort: 15889,
      isTest: false,
    })).resolves.toBe(viteDevServer);

    expect(createServer).toHaveBeenCalledWith(expect.objectContaining({
      root: '/project',
      base: '/assets/',
      logLevel: 'info',
      server: {
        middlewareMode: true,
        watch: {
          usePolling: false,
          interval: 200,
        },
        ws: {
          port: 15889,
        },
      },
      appType: 'custom',
    }));
  });
});