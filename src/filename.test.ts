// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getAssetFileName, getEntryFileName, getChunkFileName, getScriptEntryName } from './filename.ts';

describe('asset filenames', () => {
  it.each([
    ['style.css', 'assets/css/style.0x[hash].css'],
    ['images/myIcon.svg', 'assets/images/my-icon.0x[hash].svg'],
    ['fonts/font.woff2', 'assets/fonts/font.0x[hash].woff2'],
    ['worker.js', 'assets/js/worker.0x[hash].js'],
    ['info.json', 'assets/info.0x[hash].json'],
    ['my_component name', 'assets/my-component-name.0x[hash]'],
    ['myBigComponent.CSS', 'assets/css/my-big-component.0x[hash].CSS'],
    ['a__b  c.png', 'assets/images/a-b-c.0x[hash].png'],
  ])('preserves the actual extension of %s', (name, expected) => {
    expect(getAssetFileName({ name })).toBe(expected);
  });
  it('prefers modern names metadata and handles unnamed assets', () => {
    expect(getAssetFileName({ names: ['images\\icon.svg'], name: 'obsolete.css' })).toBe('assets/images/icon.0x[hash].svg');
    expect(getAssetFileName({})).toBe('assets/asset.0x[hash]');
    expect(getAssetFileName({ names: [], name: 'x.css' })).toBe('assets/css/x.0x[hash].css');
  });
  it('preserves entry and chunk naming contracts', () => {
    expect(getEntryFileName({ name: 'entry-server' })).toBe('entry-server.js');
    for (const name of ['index', 'react-loader']) expect(getEntryFileName({ name })).toBe('assets/js/react-loader.0x[hash].js');
    expect(getEntryFileName({ name: 'colorMode' })).toBe('assets/js/color-mode.js');
    expect(getChunkFileName({ name: 'myChunk' })).toBe('assets/js/my-chunk.0x[hash].js');
    expect(getChunkFileName({})).toBe('assets/js/.0x[hash].js');
    expect(getScriptEntryName('src\\MyComponent.entry.tsx')).toBe('my-component');
  });
});
