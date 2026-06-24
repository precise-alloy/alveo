import type { PluginOption } from 'vite';

const VIRTUAL_PAGES_ID = 'virtual:alveo/pages';
const VIRTUAL_CLIENT_COMPONENTS_ID = 'virtual:alveo/client-components';
const VIRTUAL_SVG_SPRITES_ID = 'virtual:alveo/svg-sprites';
const RESOLVED_VIRTUAL_PAGES_ID = '\0' + VIRTUAL_PAGES_ID;
const RESOLVED_VIRTUAL_CLIENT_COMPONENTS_ID = '\0' + VIRTUAL_CLIENT_COMPONENTS_ID;
const RESOLVED_VIRTUAL_SVG_SPRITES_ID = '\0' + VIRTUAL_SVG_SPRITES_ID;

/**
 * Vite plugin that provides virtual modules for consumer project assets:
 * - `virtual:alveo/pages` — glob-imports consumer's `src/pages/*.tsx`
 * - `virtual:alveo/client-components` — re-exports consumer's `src/client-components.tsx`
 * - `virtual:alveo/svg-sprites` — glob-imports consumer's `public/assets/images/*.svg` as raw strings
 */
export function virtualModules(): PluginOption {
  return {
    name: 'alveo-virtual-modules',
    enforce: 'pre',

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
        return "export const sprites = import.meta.glob(['/public/assets/images/*.svg'], { query: '?raw', import: 'default' });";
      }

      return undefined;
    },
  };
}

export { VIRTUAL_PAGES_ID, VIRTUAL_CLIENT_COMPONENTS_ID, VIRTUAL_SVG_SPRITES_ID };
