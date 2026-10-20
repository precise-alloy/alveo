// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';

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
      manualChunks: expect.any(Function),
    });
    expect(config.build?.minify).toBe('oxc');
    expect(config.css?.preprocessorOptions?.scss).toMatchObject({ quietDeps: true });
    expect(config.plugins).toContain(extra);
    expect(
      config.plugins?.flat(Infinity).map((plugin) => (typeof plugin === 'object' && plugin && 'name' in plugin ? plugin.name : ''))
    ).not.toContain('alveo-build-start');
    const lifecycle = config.plugins![0] as { config: (config: object, env: { mode: string }) => { base: string } };

    expect(lifecycle.config({}, { mode: 'development' })).toEqual({ base: '/subpath/' });
    expect(loadEnv).toHaveBeenLastCalledWith('eshn', '/project');
  });
  it('uses the actual Vite mode and its environment when no override is given', () => {
    const config = defineAlveoConfig();
    const lifecycle = config.plugins![0] as { config: (config: object, env: { mode: string }) => { base: string } };

    vi.mocked(loadEnv).mockReturnValueOnce({ VITE_BASE_URL: '/development/' });
    expect(lifecycle.config({}, { mode: 'development' })).toEqual({ base: '/development/' });
    vi.mocked(loadEnv).mockReturnValueOnce({});
    expect(lifecycle.config({}, { mode: 'custom' })).toEqual({ base: '/' });
  });
});
