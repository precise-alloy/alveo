import type { Express } from 'express';
import type { ViteDevServer } from 'vite';
import type { RenderOutput } from './entry-server.tsx';

import fs from 'node:fs';
import path from 'node:path';

import rateLimit from 'express-rate-limit';
import * as cheerio from 'cheerio';
import jsBeautify from 'js-beautify';
import slash from 'slash';

import { getPackageRoot } from './paths.ts';
import { beautifyOptions, removeDuplicateAssets, replacePlaceholder, updateResourcePath } from './prerender-core.ts';

interface Props {
  app: Pick<Express, 'use'>;
  viteDevServer: Pick<ViteDevServer, 'transformIndexHtml' | 'ssrLoadModule' | 'ssrFixStacktrace'>;
  resolve: (path: string) => string;
  baseUrl: string;
  domain?: string;
}

const rendererRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000000,
  standardHeaders: true,
  legacyHeaders: false,
});

export const _useRenderer = ({ app, viteDevServer, resolve, baseUrl, domain }: Props) => {
  const entryServerPath = slash(path.join(getPackageRoot(), 'dist/entry-server.js'));

  app.use(rendererRateLimiter, async (req, res) => {
    try {
      const template = await viteDevServer.transformIndexHtml(req.originalUrl, fs.readFileSync(resolve('index.html'), 'utf8'));
      const { render } = (await viteDevServer.ssrLoadModule(entryServerPath)) as { render: (url: string) => RenderOutput | Promise<RenderOutput> };
      const output = await render(req.originalUrl);
      const $ = cheerio.load(replacePlaceholder(template, '<!--app-html-->', output.html));
      const paths: string[] = [];

      removeDuplicateAssets($, 'link[data-pl-require][href]', 'href', paths);
      removeDuplicateAssets($, 'script[data-pl-require][src]', 'src', paths);
      // Development must refresh stable filenames without requiring completed
      // disk output from the parallel watcher. Prerender uses deterministic
      // content hashes instead; both paths share URL and asset-relocation rules.
      const resourceOptions = {
        addHash: false,
        baseUrl,
        domain,
        toAbsolute: resolve,
        existsSync: fs.existsSync,
        readFileSync: fs.readFileSync,
        cacheVersion: String(Date.now()),
      };

      updateResourcePath($, 'link', 'href', resourceOptions);
      updateResourcePath($, 'script', 'src', resourceOptions);
      updateResourcePath($, 'img', 'src', resourceOptions);

      const html = replacePlaceholder(jsBeautify.html_beautify($.html(), beautifyOptions), '/* app-styles */', output.styles);

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));

      viteDevServer.ssrFixStacktrace(error);
      console.error('[alveo] SSR request failed:', error);
      res.status(500).end('Internal Server Error');
    }
  });
};
