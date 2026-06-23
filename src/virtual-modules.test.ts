// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { virtualModules, VIRTUAL_PAGES_ID, VIRTUAL_CLIENT_COMPONENTS_ID, VIRTUAL_SVG_SPRITES_ID } from './virtual-modules.js';

describe('alveo/virtual-modules.ts', () => {
  const projectRoot = '/project/root';
  const plugin = virtualModules(projectRoot) as {
    name: string;
    enforce: string;
    resolveId: (id: string) => string | undefined;
    load: (id: string) => string | undefined;
  };

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
      expect(code).toContain('/project/root/src/client-components');
    });

    it('returns glob import code for the svg-sprites virtual module', () => {
      const code = plugin.load('\0' + VIRTUAL_SVG_SPRITES_ID);

      expect(code).toBeDefined();
      expect(code).toContain('import.meta.glob');
      expect(code).toContain('/public/assets/images/*.svg');
      expect(code).toContain("query: '?raw'");
      expect(code).toContain('export const sprites');
    });

    it('returns undefined for unknown resolved IDs', () => {
      expect(plugin.load('\0unknown-module')).toBeUndefined();
      expect(plugin.load('some-other-id')).toBeUndefined();
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
