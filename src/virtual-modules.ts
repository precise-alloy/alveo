import type { PluginOption, ResolvedConfig } from 'vite';

import fs from 'fs';
import path from 'path';

import slash from 'slash';

import { getPackageRoot } from './paths.ts';

const VIRTUAL_PAGES_ID = 'virtual:alveo/pages';
const VIRTUAL_CLIENT_COMPONENTS_ID = 'virtual:alveo/client-components';
const VIRTUAL_SVG_SPRITES_ID = 'virtual:alveo/svg-sprites';
const RESOLVED_VIRTUAL_PAGES_ID = '\0' + VIRTUAL_PAGES_ID;
const RESOLVED_VIRTUAL_CLIENT_COMPONENTS_ID = '\0' + VIRTUAL_CLIENT_COMPONENTS_ID;
const RESOLVED_VIRTUAL_SVG_SPRITES_ID = '\0' + VIRTUAL_SVG_SPRITES_ID;

/**
 * Sub-path (relative to the consumer's Vite `publicDir`) that holds the SVG
 * sprite sheets consumed by the icon-list dialog. Files here are served from the
 * site root (e.g. `<publicDir>/assets/images/icons.svg` → `/assets/images/icons.svg`).
 */
const SVG_SPRITES_SUBDIR = 'assets/images';

/**
 * Builds the source for the `virtual:alveo/svg-sprites` module.
 *
 * Historically this used `import.meta.glob(['/public/assets/images/*.svg'], …)`.
 * Because those files live in Vite's `publicDir`, importing them from JavaScript
 * makes Vite emit "Assets in public directory cannot be imported from JavaScript"
 * on every dev request. Public assets are already served from the site root, so
 * instead of importing them we fetch each one at runtime by its public URL. The
 * `import.meta.env.BASE_URL` prefix keeps the URLs correct when the site is served
 * under a non-root base. The generated shape stays `Record<string, () => Promise<string>>`
 * (see `src/types.d.ts`) so the consuming `icon-list-dialog` component is unchanged.
 *
 * @param spriteFiles - SVG file names discovered in the consumer's public sprites folder
 */
function buildSvgSpritesModule(spriteFiles: string[]): string {
  // Serialize as root-relative public paths (e.g. `assets/images/icons.svg`).
  const relativePaths = spriteFiles.map((file) => `${SVG_SPRITES_SUBDIR}/${file}`);

  return `const files = ${JSON.stringify(relativePaths)};
const base = (import.meta.env.BASE_URL || '/').replace(/\\/$/, '');
export const sprites = Object.fromEntries(
  files.map((file) => [
    '/' + file,
    () =>
      fetch(base + '/' + file).then((res) => {
        if (!res.ok) {
          throw new Error('Failed to load SVG sprite "' + file + '" (' + res.status + ')');
        }

        return res.text();
      }),
  ]),
);
`;
}

/**
 * Vite plugin that provides virtual modules for consumer project assets:
 * - `virtual:alveo/pages` — glob-imports consumer's `src/pages/*.tsx`
 * - `virtual:alveo/client-components` — re-exports consumer's `src/client-components.tsx`
 * - `virtual:alveo/svg-sprites` — fetches the consumer's `public/assets/images/*.svg` files at runtime
 */
export function virtualModules(): PluginOption {
  // Absolute path to the consumer's public sprites folder, captured from the
  // resolved Vite config so we honour a customised `publicDir`.
  let spritesDir: string | undefined;

  return {
    name: 'alveo-virtual-modules',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      // `publicDir` is `''` when the consumer disables the public directory.
      spritesDir = config.publicDir ? path.resolve(config.publicDir, SVG_SPRITES_SUBDIR) : undefined;
    },

    resolveId(id) {
      if (id === VIRTUAL_PAGES_ID) {
        return RESOLVED_VIRTUAL_PAGES_ID;
      }

      if (id === VIRTUAL_CLIENT_COMPONENTS_ID) {
        return RESOLVED_VIRTUAL_CLIENT_COMPONENTS_ID;
      }

      if (id === VIRTUAL_SVG_SPRITES_ID) {
        return RESOLVED_VIRTUAL_SVG_SPRITES_ID;
      }

      // Resolve the HTML entry `/alveo/react-loader` (and legacy `.tsx`) to the packaged build output,
      // since `src/` is not published with the npm package.
      if (id === '/alveo/react-loader' || id === '/alveo/react-loader.tsx') {
        return slash(path.resolve(getPackageRoot(), 'dist/react-loader.js'));
      }

      return undefined;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_PAGES_ID) {
        // Vite resolves import.meta.glob patterns relative to the file,
        // but since this is a virtual module, we use an absolute glob rooted
        // at the consumer's project (the Vite root).
        return "export const pages = import.meta.glob('/src/pages/*.tsx', { eager: true });";
      }

      if (id === RESOLVED_VIRTUAL_CLIENT_COMPONENTS_ID) {
        return "export { clientComponents } from '/src/client-components';";
      }

      if (id === RESOLVED_VIRTUAL_SVG_SPRITES_ID) {
        // Enumerate the SVG sprite sheets from the consumer's public folder and
        // generate runtime `fetch` loaders (see buildSvgSpritesModule). Reading the
        // directory lazily here keeps the sprite list in sync whenever the virtual
        // module is (re)loaded, and avoids importing public assets from JavaScript.
        let spriteFiles: string[] = [];

        if (spritesDir && fs.existsSync(spritesDir)) {
          spriteFiles = fs
            .readdirSync(spritesDir)
            .filter((file) => file.toLowerCase().endsWith('.svg'))
            .sort();
        }

        return buildSvgSpritesModule(spriteFiles);
      }

      return undefined;
    },
  };
}

export { VIRTUAL_PAGES_ID, VIRTUAL_CLIENT_COMPONENTS_ID, VIRTUAL_SVG_SPRITES_ID, buildSvgSpritesModule };
