import type { HTMLBeautifyOptions, JSBeautifyOptions } from 'js-beautify';

import path from 'path';

import * as cheerio from 'cheerio';

import { normalizeTextLikeContent } from './text-normalization.ts';
import { getAssetVersion, hasContentHashInFileName } from './cryptography.ts';

export { hasContentHashInFileName };
export const hashFileContent = getAssetVersion;

export const beautifyOptions: HTMLBeautifyOptions & JSBeautifyOptions = {
  indent_size: 2,
  indent_char: ' ',
  keep_array_indentation: false,
  break_chained_methods: false,
  indent_scripts: 'normal',
  brace_style: 'collapse',
  space_before_conditional: true,
  unescape_strings: false,
  jslint_happy: false,
  end_with_newline: false,
  wrap_line_length: 0,
  indent_inner_html: false,
  comma_first: false,
  e4x: false,
  indent_empty_lines: false,
  wrap_attributes: 'force',
  max_preserve_newlines: 5,
  preserve_newlines: true,
};

export const normalizeBaseUrl = (baseUrl: string): string => (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');

// A replacement string interprets $&, $$, $` and $'. Rendered content must be
// inserted literally, including currency, code examples and serialized props.
export const replacePlaceholder = (template: string, placeholder: string, content: string): string => template.replace(placeholder, () => content);

export interface PrerenderArgs {
  mode: string;
  addHash: boolean;
}

export interface ResourcePathOptions {
  addHash: boolean;
  baseUrl: string;
  domain?: string;
  toAbsolute: (value: string) => string;
  existsSync: (value: string) => boolean;
  readFileSync: (value: string) => Buffer;
  onMissingPath?: (value: string) => void;
  cacheVersion?: string;
}

export const parsePrerenderArgs = (argv: string[]): PrerenderArgs => {
  const argvModeIndex = argv.indexOf('--mode');
  const mode =
    argvModeIndex >= 0 && argvModeIndex < argv.length - 1 && !argv[argvModeIndex + 1]!.startsWith('-') ? argv[argvModeIndex + 1]! : 'production';

  return {
    mode,
    addHash: argv.includes('--add-hash'),
  };
};

export const viteAbsoluteUrl = (
  { baseUrl, pathExtension = '' }: { baseUrl: string; pathExtension?: string },
  remain: string,
  addExtension = false
): string => {
  const normalizedRemain = (remain?.startsWith('/') ? remain : '/' + remain) + (addExtension && !remain.endsWith('/') ? pathExtension : '');

  if (!baseUrl) {
    return normalizedRemain;
  }

  if (!baseUrl.endsWith('/')) {
    return baseUrl + normalizedRemain;
  }

  return baseUrl.substring(0, baseUrl.length - 1) + normalizedRemain;
};

const isVersionableResource = (pathname: string, baseUrl: string): boolean =>
  pathname.startsWith(baseUrl) &&
  !pathname.startsWith(baseUrl + 'assets/vendors/') &&
  ['.css', '.ico', '.js', '.webmanifest', '.svg'].includes(path.extname(pathname).toLowerCase()) &&
  !hasContentHashInFileName(pathname);

export const getUpdatedResourcePath = (href: string, options: ResourcePathOptions): string => {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }

  const domain = options.domain?.replace(/\/+$/, '') ?? '';
  let newPath = domain + href;

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const pathname = href.split(/[?#]/, 1)[0]!;

  if (isVersionableResource(pathname, baseUrl)) {
    const absolutePath = options.toAbsolute('dist/static/' + pathname.substring(baseUrl.length));

    if (options.cacheVersion !== undefined || options.existsSync(absolutePath)) {
      if (options.cacheVersion !== undefined || options.addHash) {
        const version = options.cacheVersion ?? hashFileContent(normalizeTextLikeContent(pathname, options.readFileSync(absolutePath)));
        const url = new URL(href, 'https://alveo.invalid');

        url.searchParams.set('v', version);
        newPath = domain + url.pathname + url.search + url.hash;
      }
    } else if (!absolutePath.endsWith('mock-api.js')) {
      options.onMissingPath?.(absolutePath);
    }
  }

  return newPath;
};

export const updateResourcePath = ($: cheerio.CheerioAPI, tagName: string, attr: string, options: ResourcePathOptions): void => {
  $(tagName).each((_, element) => {
    const href = $(element).attr(attr);

    if (!href) {
      return;
    }

    const newPath = getUpdatedResourcePath(href, options);

    if (newPath !== href) {
      $(element).attr(attr, newPath);
    }
  });
};

export const removeStyleBase = ($: cheerio.CheerioAPI): void => {
  $('link[rel="stylesheet"]').each((_, element) => {
    const href = $(element).attr('href');

    if (href?.includes('style-base')) {
      $(element).remove();
    }
  });
};

export const removeDuplicateAssets = ($: cheerio.CheerioAPI, selector: string, attr: string, paths: string[]): void => {
  $(selector).each((_, element) => {
    if ($(element).attr('data-pl-inplace') === 'true') {
      return;
    }

    const resourcePath = $(element).attr(attr);

    if (!resourcePath) {
      return;
    }

    const html = $.html(element);

    $(element).after('\n<!-- ' + html + ' -->');

    if (paths.includes(resourcePath)) {
      $(element).remove();

      return;
    }

    paths.push(resourcePath);
    $(element).removeAttr('data-pl-require');

    if ($(element).attr('type') === 'module') {
      const deferValue = $(element).attr('defer');

      if ($(element).attr('defer') === '' || deferValue === 'defer' || deferValue === 'true') {
        $(element).removeAttr('defer');
      }
    }

    $('head').append(element);
  });
};
