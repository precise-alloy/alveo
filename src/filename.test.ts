// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { globSync } from 'glob';
import slash from 'slash';
import { describe, expect, it } from 'vitest';

import { getAssetFileName, getEntryFileName, getChunkFileName, getScriptEntryName, SCRIPT_ENTRY_IGNORE_PATTERNS } from './filename.ts';

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

describe('SCRIPT_ENTRY_IGNORE_PATTERNS', () => {
  it('excludes test/spec entries and __tests__/__mocks__ fixtures with real glob matching', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-entry-ignore-'));

    try {
      for (const file of [
        'main.entry.ts',
        'main.test.entry.ts',
        'main.spec.entry.tsx',
        '__tests__/a.entry.ts',
        '__mocks__/b.entry.js',
        'nested/c.entry.jsx',
      ]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), '');
      }

      const found = globSync(slash(path.join(root, '**/*.entry.{js,jsx,ts,tsx}')), { ignore: [...SCRIPT_ENTRY_IGNORE_PATTERNS] })
        .map((file) => slash(path.relative(root, file)))
        .sort();

      expect(found).toEqual(['main.entry.ts', 'nested/c.entry.jsx']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
