// @vitest-environment node

import type { ResolvedConfig } from 'vite';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { virtualModules, VIRTUAL_PAGES_ID, VIRTUAL_CLIENT_COMPONENTS_ID, VIRTUAL_SVG_SPRITES_ID, buildSvgSpritesModule } from './virtual-modules.ts';

type TestPlugin = {
  name: string;
  enforce: string;
  configResolved: (config: ResolvedConfig) => void;
  resolveId: (id: string) => string | undefined;
  load: (id: string) => string | undefined;
};

describe('alveo/virtual-modules.ts', () => {
  const plugin = virtualModules() as TestPlugin;

  describe('resolveId', () => {
    it('resolves the pages virtual module ID', () => {
      const resolved = plugin.resolveId(VIRTUAL_PAGES_ID);

      expect(resolved).toBe('\0' + VIRTUAL_PAGES_ID);
    });

    it('resolves the client-components virtual module ID', () => {
      const resolved = plugin.resolveId(VIRTUAL_CLIENT_COMPONENTS_ID);

      expect(resolved).toBe('\0' + VIRTUAL_CLIENT_COMPONENTS_ID);
    });

    it('resolves the svg-sprites virtual module ID', () => {
      const resolved = plugin.resolveId(VIRTUAL_SVG_SPRITES_ID);

      expect(resolved).toBe('\0' + VIRTUAL_SVG_SPRITES_ID);
    });

    it('returns undefined for unknown module IDs', () => {
      expect(plugin.resolveId('some-other-module')).toBeUndefined();
      expect(plugin.resolveId('./local-import')).toBeUndefined();
    });

    describe('/alveo/react-loader resolution', () => {
      it('resolves to dist/react-loader.js', () => {
        const resolved = plugin.resolveId('/alveo/react-loader');

        expect(resolved).toMatch(/dist\/react-loader\.js$/);
      });

      it('handles /alveo/react-loader.tsx for backward compatibility', () => {
        const resolved = plugin.resolveId('/alveo/react-loader.tsx');

        expect(resolved).toMatch(/dist\/react-loader\.js$/);
      });

      it('returns forward-slash-normalized paths', () => {
        const resolved = plugin.resolveId('/alveo/react-loader');

        expect(resolved).not.toContain('\\');
      });
    });
  });

  describe('load', () => {
    it('returns glob import code for the pages virtual module', () => {
      const code = plugin.load('\0' + VIRTUAL_PAGES_ID);

      expect(code).toBeDefined();
      expect(code).toContain('import.meta.glob');
      expect(code).toContain('/src/pages/*.tsx');
      expect(code).toContain('eager: true');
      expect(code).toContain('export const pages');
    });

    it('returns re-export code for the client-components virtual module', () => {
      const code = plugin.load('\0' + VIRTUAL_CLIENT_COMPONENTS_ID);

      expect(code).toBeDefined();
      expect(code).toContain('clientComponents');
      expect(code).toContain('src/client-components');
    });

    it('uses the project root to resolve the client-components path', () => {
      const code = plugin.load('\0' + VIRTUAL_CLIENT_COMPONENTS_ID);

      // The path should contain the resolved projectRoot
      expect(code).toContain("export { clientComponents } from '/src/client-components';");
    });

    it('returns fetch-based sprite loaders for the svg-sprites virtual module', () => {
      const code = plugin.load('\0' + VIRTUAL_SVG_SPRITES_ID);

      expect(code).toBeDefined();
      // Must not import from the public directory (that triggers Vite's
      // "Assets in public directory cannot be imported from JavaScript" warning).
      expect(code).not.toContain('import.meta.glob');
      expect(code).not.toContain('/public/');
      expect(code).toContain('export const sprites');
      expect(code).toContain('fetch(');
    });

    it('returns undefined for unknown resolved IDs', () => {
      expect(plugin.load('\0unknown-module')).toBeUndefined();
      expect(plugin.load('some-other-id')).toBeUndefined();
    });
  });

  describe('svg-sprites enumeration', () => {
    it('lists SVG files from the resolved publicDir sprites folder', () => {
      const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-sprites-'));
      const imagesDir = path.join(publicDir, 'assets', 'images');
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.writeFileSync(path.join(imagesDir, 'icons.svg'), '<svg></svg>');
      fs.writeFileSync(path.join(imagesDir, 'logo.svg'), '<svg></svg>');
      // Non-SVG files must be ignored.
      fs.writeFileSync(path.join(imagesDir, 'notes.txt'), 'ignore me');

      const instance = virtualModules() as TestPlugin;
      instance.configResolved({ publicDir } as ResolvedConfig);
      const code = instance.load('\0' + VIRTUAL_SVG_SPRITES_ID);

      expect(code).toContain('assets/images/icons.svg');
      expect(code).toContain('assets/images/logo.svg');
      expect(code).not.toContain('notes.txt');

      fs.rmSync(publicDir, { recursive: true, force: true });
    });

    it('emits an empty sprite list when the public directory is disabled', () => {
      const instance = virtualModules() as TestPlugin;
      instance.configResolved({ publicDir: '' } as ResolvedConfig);
      const code = instance.load('\0' + VIRTUAL_SVG_SPRITES_ID);

      expect(code).toContain('const files = []');
    });

    it('emits an empty sprite list when the sprites folder is missing', () => {
      const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-sprites-'));

      const instance = virtualModules() as TestPlugin;
      instance.configResolved({ publicDir } as ResolvedConfig);
      const code = instance.load('\0' + VIRTUAL_SVG_SPRITES_ID);

      expect(code).toContain('const files = []');

      fs.rmSync(publicDir, { recursive: true, force: true });
    });
  });

  describe('buildSvgSpritesModule', () => {
    it('generates root-relative public URLs (never /public/) keyed by sprite path', () => {
      const code = buildSvgSpritesModule(['icons.svg', 'logo.svg']);

      expect(code).toContain('"assets/images/icons.svg"');
      expect(code).toContain('"assets/images/logo.svg"');
      expect(code).not.toContain('/public/');
      expect(code).not.toContain('import.meta.glob');
    });

    it('honours the Vite base URL when fetching sprites', () => {
      const code = buildSvgSpritesModule(['icons.svg']);

      expect(code).toContain('import.meta.env.BASE_URL');
      expect(code).toContain('fetch(base');
    });

    it('produces a runnable module exporting a record of loader functions', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<svg></svg>' });
      const globalWithFetch = globalThis as typeof globalThis & { fetch?: typeof fetch };
      const previousFetch = globalWithFetch.fetch;

      globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

      try {
        const code = buildSvgSpritesModule(['icons.svg']);
        // Evaluate the generated module body with a stubbed `import.meta.env`.
        const factory = new Function(
          'importMetaEnv',
          code.replace(/import\.meta\.env/g, 'importMetaEnv').replace('export const sprites', 'const sprites') + '\nreturn sprites;'
        );
        const sprites = factory({ BASE_URL: '/portal/' }) as Record<string, () => Promise<string>>;

        expect(Object.keys(sprites)).toEqual(['/assets/images/icons.svg']);

        const result = await sprites['/assets/images/icons.svg']!();

        expect(result).toBe('<svg></svg>');
        expect(fetchMock).toHaveBeenCalledWith('/portal/assets/images/icons.svg');
      } finally {
        globalWithFetch.fetch = previousFetch;
      }
    });

    it('rejects when a sprite fails to load', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });
      const globalWithFetch = globalThis as typeof globalThis & { fetch?: typeof fetch };
      const previousFetch = globalWithFetch.fetch;

      globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

      try {
        const code = buildSvgSpritesModule(['icons.svg']);
        const factory = new Function(
          'importMetaEnv',
          code.replace(/import\.meta\.env/g, 'importMetaEnv').replace('export const sprites', 'const sprites') + '\nreturn sprites;'
        );
        const sprites = factory({ BASE_URL: '/' }) as Record<string, () => Promise<string>>;

        await expect(sprites['/assets/images/icons.svg']!()).rejects.toThrow(/Failed to load SVG sprite/);
      } finally {
        globalWithFetch.fetch = previousFetch;
      }
    });
  });

  describe('plugin metadata', () => {
    it('has the correct plugin name', () => {
      expect(plugin.name).toBe('alveo-virtual-modules');
    });

    it('enforces pre-resolution order', () => {
      expect(plugin.enforce).toBe('pre');
    });
  });
});
