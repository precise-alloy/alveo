// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

import transform from './transform.ts';

describe('Vite-managed asset URL modules', () => {
  it('does not mistake packaged /dist/assets URLs for missing public assets', async () => {
    // realpath expands Windows 8.3 short names (RUNNER~1). Vite's fs.allow
    // compares long, real paths, so a short root would deny its own files.
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alveo-asset-url-')));
    let server: ViteDevServer | undefined;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await fs.mkdir(path.join(root, 'dist/assets'), { recursive: true });
      await fs.writeFile(path.join(root, 'dist/assets/root.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      server = await createServer({
        root,
        configFile: false,
        base: '/subpath/',
        build: { assetsInlineLimit: 0 },
        server: { middlewareMode: true, hmr: false },
        plugins: [
          transform({
            projectRoot: root,
            packageRoot: root,
            srcRoot: path.join(root, 'src'),
            outDir: path.join(root, 'dist'),
            mode: 'development',
            env: {},
          }),
        ],
      });
      const result = await server.transformRequest('/dist/assets/root.svg?url');

      expect(result?.code).toContain('/subpath/dist/assets/root.svg');
      expect(error).not.toHaveBeenCalled();
    } finally {
      await server?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
