// Pre-render the app into static HTML.
// run `alveo generate` and then `dist/static` can be served as a static site.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import jsBeautify from 'js-beautify';
import * as cheerio from 'cheerio';
import slash from 'slash';
import { loadEnv } from 'vite';
import chalk from 'chalk';

import {
  beautifyOptions,
  removeDuplicateAssets,
  removeStyleBase,
  replacePlaceholder,
  updateResourcePath,
  viteAbsoluteUrl,
} from './prerender-core.ts';
import { normalizeTextLineEndings } from './text-normalization.ts';

/**
 * Pre-renders all routes to static HTML files.
 *
 * @param projectRoot - Absolute path to the consumer project's root directory.
 * @param options - Pre-render configuration (mode, addHash).
 * @returns Missing resource paths discovered during rendering. Empty when all referenced assets exist on disk.
 */
export interface PrerenderOptions {
  mode: string;
  addHash?: boolean;
}

export interface PrerenderResult {
  missing: string[];
}

export async function prerender(projectRoot: string, options: PrerenderOptions): Promise<PrerenderResult> {
  const { mode, addHash = false } = options;

  const alveoEnv = loadEnv(mode, projectRoot);
  const toAbsolute = (p: string) => path.resolve(projectRoot, p);
  const log = console.log.bind(console);
  const missing: Set<string> = new Set();

  const template = normalizeTextLineEndings(fs.readFileSync(toAbsolute(alveoEnv.VITE_TEMPLATE ?? 'dist/static/index.html'), 'utf-8'));
  const { render, routesToPrerender, renderConfig } = await import(pathToFileURL(toAbsolute('./dist/server/entry-server.js')).href);

  if (!renderConfig || typeof renderConfig.baseUrl !== 'string') {
    throw new Error('SSR bundle is missing its resolved render configuration. Rebuild it with the current Alveo version.');
  }

  for (const route of routesToPrerender) {
    const output = await render(viteAbsoluteUrl(renderConfig, route.route, true));

    const destLocalizedFolderPath = toAbsolute('dist/static');

    let html = replacePlaceholder(template, '<!--app-html-->', output.html).replace('@style.scss', () => '/assets/css/' + route.name + '.css');
    const $ = cheerio.load(html);
    const paths: string[] = [];
    const resourcePathOptions = {
      addHash,
      baseUrl: renderConfig.baseUrl,
      domain: renderConfig.domain,
      toAbsolute,
      existsSync: fs.existsSync,
      readFileSync: fs.readFileSync,
      onMissingPath: (resourcePath: string) => {
        if (!missing.has(resourcePath)) {
          missing.add(resourcePath);
          log(chalk.yellow('Cannot find:', resourcePath));
        }
      },
    };

    removeDuplicateAssets($, 'link[data-pl-require][href]', 'href', paths);
    removeDuplicateAssets($, 'script[data-pl-require][src]', 'src', paths);
    updateResourcePath($, 'link', 'href', resourcePathOptions);
    updateResourcePath($, 'script', 'src', resourcePathOptions);
    updateResourcePath($, 'img', 'src', resourcePathOptions);
    if (route.route === '/') {
      removeStyleBase($);
    }

    $('head title').text(route.name);

    const fileName = (route.route === '/' ? '/index' : route.route) + '.html';
    const filePath = `${destLocalizedFolderPath}${fileName}`;

    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    html = $.html();

    html = normalizeTextLineEndings(jsBeautify.html_beautify(html, beautifyOptions));
    html = replacePlaceholder(html, '/* app-styles */', output.styles);

    fs.writeFileSync(toAbsolute(filePath), normalizeTextLineEndings(html));
    log('pre-rendered:', slash(filePath));
  }

  return { missing: [...missing] };
}
