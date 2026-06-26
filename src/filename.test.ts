// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { getAssetFileName, getEntryFileName, getChunkFileName } from './filename.ts';

describe('alveo/filename.ts', () => {
  describe('getAssetFileName', () => {
    it('generates a hashed CSS asset path with normalized name', () => {
      expect(getAssetFileName({ name: 'style' })).toBe('assets/js/style.0x[hash].css');
    });

    it('converts camelCase names to lower-dashed', () => {
      expect(getAssetFileName({ name: 'myComponent' })).toBe('assets/js/my-component.0x[hash].css');
    });

    it('converts underscores and spaces to dashes', () => {
      expect(getAssetFileName({ name: 'my_component name' })).toBe('assets/js/my-component-name.0x[hash].css');
    });

    it('handles undefined name', () => {
      expect(getAssetFileName({})).toBe('assets/js/.0x[hash].css');
    });
  });

  describe('getEntryFileName', () => {
    it('returns bare filename for entry-server', () => {
      expect(getEntryFileName({ name: 'entry-server' })).toBe('entry-server.js');
    });

    it('maps index to hashed react-loader path', () => {
      expect(getEntryFileName({ name: 'index' })).toBe('assets/js/react-loader.0x[hash].js');
    });

    it('maps react-loader to hashed react-loader path', () => {
      expect(getEntryFileName({ name: 'react-loader' })).toBe('assets/js/react-loader.0x[hash].js');
    });

    it('generates unhashed JS path for other entries', () => {
      expect(getEntryFileName({ name: 'colorMode' })).toBe('assets/js/color-mode.js');
    });

    it('converts camelCase entry names to lower-dashed without hash', () => {
      expect(getEntryFileName({ name: 'plStates' })).toBe('assets/js/pl-states.js');
    });
  });

  describe('getChunkFileName', () => {
    it('generates a hashed JS chunk path', () => {
      expect(getChunkFileName({ name: 'vendor' })).toBe('assets/js/vendor.0x[hash].js');
    });

    it('converts camelCase chunk names to lower-dashed', () => {
      expect(getChunkFileName({ name: 'myChunk' })).toBe('assets/js/my-chunk.0x[hash].js');
    });

    it('handles undefined name', () => {
      expect(getChunkFileName({})).toBe('assets/js/.0x[hash].js');
    });
  });

  describe('toLowerDashed (internal behavior)', () => {
    it('splits camelCase into dashed words', () => {
      // Tested through getAssetFileName which uses toLowerDashed internally
      expect(getAssetFileName({ name: 'heroSection' })).toBe('assets/js/hero-section.0x[hash].css');
    });

    it('converts multiple uppercase transitions', () => {
      expect(getAssetFileName({ name: 'myBigComponent' })).toBe('assets/js/my-big-component.0x[hash].css');
    });

    it('handles already lowercase input', () => {
      expect(getAssetFileName({ name: 'simple' })).toBe('assets/js/simple.0x[hash].css');
    });

    it('collapses multiple underscores and spaces', () => {
      expect(getAssetFileName({ name: 'a__b  c' })).toBe('assets/js/a-b-c.0x[hash].css');
    });
  });
});
