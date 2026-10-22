// @vitest-environment node
import type { AlveoContext } from './types.ts';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import transform from './transform.ts';
const { allocation } = vi.hoisted(() => ({ allocation: vi.fn() }));

vi.mock('magic-string', async (original) => {
  const actual = await original<typeof import('magic-string')>();

  return {
    ...actual,
    default: class extends actual.default {
      constructor(code: string) {
        super(code);
        allocation(code);
      }
    },
  };
});
beforeEach(() => allocation.mockClear());
const context = (mode = 'production'): AlveoContext => ({
  projectRoot: '/project',
  packageRoot: '/project/node_modules/alveo',
  srcRoot: '/project/src',
  outDir: '/project/dist',
  mode,
  env: { VITE_EXTENSION_UNIQUE_ID: 'site' },
});
const plugin = (ctx: AlveoContext) =>
  transform(ctx) as {
    transform: (code: string, id: string) => { code: string; map: unknown } | undefined;
  };

describe('targeted source transforms', () => {
  it('skips ordinary source text before allocation and skips unchanged candidates', () => {
    const hook = plugin(context());

    expect(hook.transform('const x = 1;', '/node_modules/vendor/index.js')).toBeUndefined();
    expect(hook.transform('export default "/subpath/node_modules/alveo/dist/assets/root.svg";', '/package/dist/assets/root.svg?url')).toBeUndefined();
    expect(allocation).not.toHaveBeenCalled();
    expect(hook.transform('/* /assets/ */', '/source.js')).toBeUndefined();
    expect(allocation).toHaveBeenCalledOnce();
    expect(plugin(context('development')).transform('/* ALVEO_BEGIN_DEVELOPMENT_ONLY */', '/source.js')).toBeUndefined();
  });
  it('still transforms installed Alveo modules and preserves development-only blocks in development', () => {
    const source = 'before; /* ALVEO_BEGIN_DEVELOPMENT_ONLY */ development(); /* ALVEO_END_DEVELOPMENT_ONLY */ "VITE_EXTENSION_UNIQUE_ID";';
    const result = plugin(context()).transform(source, '/project/node_modules/alveo/dist/a.js');

    expect(result?.code).toBe('before;  "site";');
    expect(result?.map).toBeDefined();
    expect(plugin(context('development')).transform(source, '/source.js')?.code).toContain('development();');
    const empty = context();

    empty.env = {};
    expect(plugin(empty).transform('"VITE_EXTENSION_UNIQUE_ID"', '/source.js')?.code).toBe('""');
  });
});
