// @vitest-environment node
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';
import slash from 'slash';

import { defineAlveoConfig } from './config.ts';

vi.mock('vite', async (original) => ({ ...(await original<typeof import('vite')>()), loadEnv: vi.fn().mockReturnValue({}) }));

describe('Alveo configuration', () => {
  it('deep-merges user output/CSS options without losing framework defaults', () => {
    const extra = { name: 'extra' };
    const config = defineAlveoConfig({
      root: '/project',
      mode: 'eshn',
      base: '/subpath/',
      plugins: [extra],
      build: { rolldownOptions: { output: { sourcemap: true } } },
      css: { preprocessorOptions: { scss: { quietDeps: true } } },
    });

    expect(config.build?.rolldownOptions?.output).toMatchObject({
      sourcemap: true,
      entryFileNames: expect.any(Function),
      chunkFileNames: expect.any(Function),
      assetFileNames: expect.any(Function),
      sourcemapPathTransform: expect.any(Function),
      manualChunks: expect.any(Function),
    });
    expect(config.build?.rolldownOptions?.optimization).toEqual({ inlineConst: true });
    expect(config.build?.rolldownOptions?.preserveEntrySignatures).toBe('allow-extension');
    expect(config.root).toBe(slash(path.resolve('/project')));
    expect(config.build?.minify).toBe('oxc');
    expect(config.css?.preprocessorOptions?.scss).toMatchObject({ quietDeps: true });
    expect(config.plugins).toContain(extra);
    expect(
      config.plugins?.flat(Infinity).map((plugin) => (typeof plugin === 'object' && plugin && 'name' in plugin ? plugin.name : ''))
    ).not.toContain('alveo-build-start');
    const lifecycle = config.plugins![0] as { config: (config: object, env: { mode: string }) => { base: string } | undefined };

    expect(config.base).toBe('/subpath/');
    // Vite passes the explicit base back in; the hook must leave it untouched.
    expect(lifecycle.config({ base: '/subpath/' }, { mode: 'development' })).toBeUndefined();
    // The project root is resolved and slash-normalized (drive letter on Windows).
    expect(loadEnv).toHaveBeenLastCalledWith('eshn', slash(path.resolve('/project')));
  });
  it('uses the actual Vite mode and its environment when no override is given', () => {
    const config = defineAlveoConfig();
    const lifecycle = config.plugins![0] as { config: (config: object, env: { mode: string }) => { base: string } | undefined };

    // No static base or root when omitted: defaults must not look like explicit overrides.
    expect(config).not.toHaveProperty('base');
    expect(config).not.toHaveProperty('root');

    vi.mocked(loadEnv).mockReturnValueOnce({ VITE_BASE_URL: '/development/' });
    expect(lifecycle.config({}, { mode: 'development' })).toEqual({ base: '/development/' });
    vi.mocked(loadEnv).mockReturnValueOnce({});
    expect(lifecycle.config({}, { mode: 'custom' })).toEqual({ base: '/' });
  });
});
