// @vitest-environment node

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./paths.js', () => ({
  getAbsolutePath: vi.fn((p: string, projectRoot: string) => {
    const slash = (s: string) => s.replace(/\\/g, '/');

    return path.isAbsolute(p) ? slash(p) : slash(path.resolve(projectRoot, p));
  }),
}));

import { createManualChunk } from './manual-chunk.js';

describe('alveo/manual-chunk.ts', () => {
  const srcRoot = '/project/src';
  const projectRoot = '/project';
  const manualChunk = createManualChunk(srcRoot, projectRoot);

  const makeApi = (isEntry: boolean) => ({
    getModuleInfo: vi.fn().mockReturnValue({ isEntry }),
  });

  const makeNullApi = () => ({
    getModuleInfo: vi.fn().mockReturnValue(null),
  });

  describe('node_modules paths', () => {
    it('returns undefined for node_modules entries', () => {
      const result = manualChunk('/project/node_modules/react/index.js', makeApi(true));

      expect(result).toBeUndefined();
    });

    it('returns undefined for deeply nested node_modules paths', () => {
      const result = manualChunk('/project/node_modules/@scope/pkg/dist/index.js', makeApi(true));

      expect(result).toBeUndefined();
    });
  });

  describe('non-entry modules', () => {
    it('returns undefined for non-entry internal modules', () => {
      const result = manualChunk('/project/src/atoms/button.tsx', makeApi(false));

      expect(result).toBeUndefined();
    });

    it('returns undefined when getModuleInfo returns null', () => {
      const result = manualChunk('/project/src/atoms/button.tsx', makeNullApi());

      expect(result).toBeUndefined();
    });
  });

  describe('entry modules inside srcRoot', () => {
    it('returns category~component for entry files under src', () => {
      const result = manualChunk('/project/src/atoms/button.tsx', makeApi(true));

      expect(result).toBe('atoms~button');
    });

    it('returns category~component for organisms', () => {
      const result = manualChunk('/project/src/organisms/hero.tsx', makeApi(true));

      expect(result).toBe('organisms~hero');
    });

    it('returns undefined when the relative path does not match the two-segment pattern', () => {
      // Three segments: atoms/button/index.tsx does not match the pattern
      const result = manualChunk('/project/src/atoms/button/index.tsx', makeApi(true));

      expect(result).toBeUndefined();
    });
  });

  describe('entry modules outside srcRoot', () => {
    it('returns undefined for entry modules outside the src root', () => {
      const result = manualChunk('/other/project/src/atoms/button.tsx', makeApi(true));

      expect(result).toBeUndefined();
    });
  });
});
