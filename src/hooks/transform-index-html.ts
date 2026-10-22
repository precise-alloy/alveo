import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import * as cheerio from 'cheerio';

import { normalizeBaseUrl } from '../prerender-core.ts';

import { isMockApiEnabled } from './options.ts';

const transformIndexHtml = (baseUrl: string, context?: AlveoContext): PluginOption => {
  let base = normalizeBaseUrl(baseUrl);

  return {
    name: 'alveo-transform-index-html',
    enforce: 'post',

    configResolved(config) {
      base = normalizeBaseUrl(config.base);
    },

    transformIndexHtml(html) {
      const result = html.replaceAll('#__BASE_URL__/', () => base);

      if (!context || isMockApiEnabled(context)) return result;

      // Parse real tags, not script-looking text inside JSON or inline JS.
      // Only legacy templates mentioning the optional entry need this pass.
      if (!result.includes('mock-api.js')) return result;
      const $ = cheerio.load(result);
      let removed = false;

      $('script[src]').each((_, element) => {
        // The selector guarantees a src attribute, including an empty one.
        const src = $(element).attr('src')!;

        if (src.split(/[?#]/, 1)[0] === base + 'assets/js/mock-api.js') {
          $(element).remove();
          removed = true;
        }
      });

      return removed ? $.html() : result;
    },
  };
};

export default transformIndexHtml;
