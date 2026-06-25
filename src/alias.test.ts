// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAliases } from './alias.js';

describe('alveo/alias.ts', () => {
  describe('createAliases', () => {
    it('returns exactly 11 alias entries', () => {
      const aliases = createAliases('/project/root');

      expect(aliases).toHaveLength(11);
    });

    it('maps all expected alias names', () => {
      const aliases = createAliases('/project/root');
      const finds = aliases.map((a) => a.find);

      expect(finds).toEqual([
        '@atoms',
        '@molecules',
        '@organisms',
        '@templates',
        '@pages',
        '@assets',
        '@helpers',
        '@data',
        '@_http',
        '@_api',
        '@mocks',
      ]);
    });

    it('resolves source aliases relative to projectRoot/src', () => {
      const aliases = createAliases('/project/root');
      const atomsAlias = aliases.find((a) => a.find === '@atoms');
      const helpersAlias = aliases.find((a) => a.find === '@helpers');

      expect(atomsAlias?.replacement).toContain('/src/atoms');
      expect(helpersAlias?.replacement).toContain('/src/_helpers');
    });

    it('uses forward slashes in all paths (normalized)', () => {
      const aliases = createAliases('/project/root');

      aliases.forEach((alias) => {
        expect(alias.replacement).not.toContain('\\');
      });
    });

    it('resolves paths relative to different project roots', () => {
      const aliasesA = createAliases('/workspace/project-a');
      const aliasesB = createAliases('/workspace/project-b');
      const atomsA = aliasesA.find((a) => a.find === '@atoms');
      const atomsB = aliasesB.find((a) => a.find === '@atoms');

      expect(atomsA?.replacement).toContain('project-a');
      expect(atomsB?.replacement).toContain('project-b');
    });
  });
});
