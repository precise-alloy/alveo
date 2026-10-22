import type { Server } from 'node:http';

import path from 'node:path';

import express from 'express';
import { loadEnv } from 'vite';
import chalk from 'chalk';

import { createViteDevServer } from './create-vite-dev-server.ts';
import { _useRenderer } from './renderer.ts';
import { assertMode } from './dev-supervisor.ts';
import { normalizeBaseUrl } from './prerender-core.ts';

export interface ServerProps {
  root: string;
  mode: string;
  isTest: boolean;
  port: number;
  hmrPort?: number;
  baseUrl?: string;
}

export function assertDevelopmentMode(mode: string): void {
  assertMode(mode);
  if (mode === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('alveo server is development-only. Use generate and deploy dist/static for production.');
  }
}

export async function createServer({ root, mode, hmrPort, baseUrl, isTest }: ServerProps) {
  assertDevelopmentMode(mode);
  const resolve = (value: string) => path.join(root, value);
  const app = express();
  const viteDevServer = await createViteDevServer({ root, mode, baseUrl, hmrPort, isTest });
  const base = normalizeBaseUrl(viteDevServer.config.base);

  app.use(viteDevServer.middlewares);
  // External compilers can replace public directories faster than Vite's file
  // cache observes them. Prefer fresh public bytes over an older dist copy even
  // when a watcher event is missed, while honoring a disabled/custom publicDir.
  if (viteDevServer.config.publicDir) {
    app.use(express.static(viteDevServer.config.publicDir, { index: false }));
  }
  // Vite serves public/transformed files first and strips its base from req.url
  // before calling downstream middleware. Mount the watch-build fallback at
  // /assets, not base + /assets, or subpath JS requests fall through to SSR HTML.
  app.use('/assets', express.static(resolve('dist/assets'), { index: false }));

  const env = loadEnv(mode, root);

  _useRenderer({ app, viteDevServer, resolve, baseUrl: base, domain: env.VITE_DOMAIN });

  return { app, viteDevServer };
}

export async function startServer(props: ServerProps): Promise<Server> {
  const { app, viteDevServer } = await createServer(props);

  try {
    const server = await new Promise<Server>((resolve, reject) => {
      const server = app.listen(props.port, () => resolve(server));

      server.once('error', reject);
    });

    console.log('Running on ' + chalk.green(`http://localhost:${props.port}${viteDevServer.config.base}`));

    return server;
  } catch (error) {
    await viteDevServer.close();
    throw error;
  }
}
