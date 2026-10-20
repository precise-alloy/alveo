// @vitest-environment node

import type { Server } from 'node:http';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createServer } from './create-server.ts';

describe('development HTTP asset routing', () => {
  it('serves watched JavaScript after the real Vite middleware strips a non-root base', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alveo-http-'));
    let server: Server | undefined;
    let closeVite: (() => Promise<void>) | undefined;

    try {
      await fs.mkdir(path.join(root, 'dist/assets/js'), { recursive: true });
      await fs.writeFile(path.join(root, 'dist/assets/js/probe.js'), 'globalThis.probe = true;');
      await fs.mkdir(path.join(root, 'public/assets/css'), { recursive: true });
      await fs.mkdir(path.join(root, 'dist/assets/css'), { recursive: true });
      await fs.writeFile(path.join(root, 'public/assets/css/known.css'), '.known{}');
      await fs.writeFile(path.join(root, 'dist/assets/css/fresh.css'), '.stale{}');
      await fs.writeFile(path.join(root, 'vite.config.mjs'), 'export default { server: { hmr: false } };');
      const created = await createServer({ root, mode: 'development', baseUrl: '/subpath/', isTest: true, port: 0 });

      closeVite = () => created.viteDevServer.close();
      server = await new Promise<Server>((resolve, reject) => {
        const listening = created.app.listen(0, '127.0.0.1', () => resolve(listening));

        listening.once('error', reject);
      });
      const address = server.address();

      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      const response = await fetch(`http://127.0.0.1:${address.port}/subpath/assets/js/probe.js?v=123`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/javascript/);
      expect(await response.text()).toBe('globalThis.probe = true;');
      await fetch(`http://127.0.0.1:${address.port}/subpath/assets/css/known.css`);
      await created.viteDevServer.watcher.unwatch(path.join(root, 'public'));
      await fs.writeFile(path.join(root, 'public/assets/css/fresh.css'), '.fresh{}');
      const fresh = await fetch(`http://127.0.0.1:${address.port}/subpath/assets/css/fresh.css?v=123`);

      expect(await fresh.text()).toBe('.fresh{}');
    } finally {
      await closeVite?.();
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
