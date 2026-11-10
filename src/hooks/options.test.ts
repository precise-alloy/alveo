// @vitest-environment node
import type { AlveoContext } from './types.ts';

import fs from 'node:fs';

import { glob } from 'glob';
import { SourceMapConsumer } from 'source-map-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCRIPT_ENTRY_IGNORE_PATTERNS } from '../filename.ts';

import options, {
  assertNotCrossEntryImport,
  getEntryOwner,
  inlineBundleEntryImports,
  isMockApiEnabled,
  resolveEntryIsolatedId,
  type OutputBundleLike,
  type ResolveResult,
} from './options.ts';
import transformIndexHtml from './transform-index-html.ts';

vi.mock('glob', () => ({ glob: { sync: vi.fn() } }));
const context = (mode = 'development'): AlveoContext => ({
  projectRoot: '/project',
  packageRoot: '/package',
  srcRoot: '/project/src',
  outDir: '/project/dist',
  mode,
  env: {},
});
const plugin = (ctx = context()) =>
  options(ctx) as {
    options: (options: { input?: string | Record<string, string> }) => unknown;
    resolveId: (
      this: { resolve: (source: string, importer?: string, options?: object) => Promise<ResolveResult | null> },
      source: string,
      importer?: string,
      resolveOptions?: object
    ) => Promise<ResolveResult | undefined>;
    generateBundle: (outputOptions: { sourcemap?: boolean }, bundle: OutputBundleLike) => Promise<void>;
  };
const htmlPlugin = (base: string, ctx?: AlveoContext) =>
  transformIndexHtml(base, ctx) as {
    configResolved: (config: { base: string }) => void;
    transformIndexHtml: (html: string) => string;
  };

afterEach(() => vi.unstubAllEnvs());

describe('optional mocks and Vite entry discovery', () => {
  it('enables mocks only when a non-production consumer has handlers', () => {
    vi.mocked(glob.sync).mockReturnValue([]);
    expect(isMockApiEnabled(context())).toBe(false);
    vi.mocked(glob.sync).mockReturnValue(['/project/src/mocks/handlers.ts']);
    expect(isMockApiEnabled(context('eshn'))).toBe(true);
    expect(isMockApiEnabled(context('production'))).toBe(false);
  });
  it('discovers entries once from the correct framework source and preserves SSR input', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.mocked(glob.sync).mockReturnValue(['/project/src/assets/scripts/MyEntry.entry.ts']);
    const hook = plugin();
    const input: { input?: string | Record<string, string> } = {};

    hook.options(input);
    expect(input.input).toEqual({ index: '/project/index.html', 'my-entry': '/project/src/assets/scripts/MyEntry.entry.ts' });
    expect(glob.sync).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('/src/scripts/')]), expect.any(Object));
    const ssr = { input: '/package/dist/entry-server.js' };

    expect(hook.options(ssr)).toBe(ssr);
  });
  it('omits HTML in script-only mode, uses packaged entries, and excludes missing mocks', () => {
    vi.stubEnv('scriptOnly', 'true');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.mocked(glob.sync).mockImplementation((pattern) => (typeof pattern === 'string' ? [] : ['/package/dist/scripts/mock-api.entry.js']));
    const input: { input?: Record<string, string> } = {};

    plugin().options(input);
    expect(input.input).toEqual({});
    expect(glob.sync).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('/dist/scripts/')]), expect.any(Object));
  });
  it('includes custom-mode mocks when configured and rejects duplicate entry names', () => {
    vi.mocked(glob.sync).mockImplementation((pattern) =>
      typeof pattern === 'string' ? ['/project/src/mocks/handlers.ts'] : ['/package/dist/scripts/mock-api.entry.js']
    );
    const input: { input?: Record<string, string> } = {};

    plugin(context('eshn')).options(input);
    expect(input.input).toHaveProperty('mock-api');
    vi.mocked(glob.sync).mockReturnValue(['/a/main.entry.ts', '/b/main.entry.ts']);
    expect(() => plugin().options({})).toThrow('Duplicate script entry');
  });
  it('treats Object.prototype names as ordinary entries, not duplicates', () => {
    vi.mocked(glob.sync).mockReturnValue(['/project/src/assets/scripts/constructor.entry.ts']);
    const input: { input?: Record<string, string> } = {};

    plugin().options(input);
    expect(Object.hasOwn(input.input!, 'constructor')).toBe(true);
    expect(input.input!['constructor']).toBe('/project/src/assets/scripts/constructor.entry.ts');
    // A real second `constructor` entry is still a duplicate.
    vi.mocked(glob.sync).mockReturnValue(['/a/constructor.entry.ts', '/b/constructor.entry.ts']);
    expect(() => plugin().options({})).toThrow('Duplicate script entry "constructor"');
  });
  it('applies the shared test/fixture exclusions to Vite entry discovery', () => {
    vi.mocked(glob.sync).mockReturnValue([]);
    plugin().options({});
    expect(glob.sync).toHaveBeenLastCalledWith(expect.any(Array), { ignore: [...SCRIPT_ENTRY_IGNORE_PATTERNS] });
  });
  it('normalizes configured and resolved bases and removes only disabled framework mock tags', () => {
    const hook = htmlPlugin('/subpath');

    expect(hook.transformIndexHtml('<img src="#__BASE_URL__/assets/a.svg">')).toContain('/subpath/assets/a.svg');
    hook.configResolved({ base: '/other/' });
    expect(hook.transformIndexHtml('#__BASE_URL__/file')).toBe('/other/file');
    expect(htmlPlugin('/$&').transformIndexHtml('#__BASE_URL__/file')).toBe('/$&/file');
    const html = '<script type="module" src="#__BASE_URL__/assets/js/mock-api.js"></script><script src="#__BASE_URL__/assets/js/main.js"></script>';
    const disabled = htmlPlugin('/subpath', context('production')).transformIndexHtml(html);

    expect(disabled).not.toContain('mock-api');
    expect(disabled).toContain('/subpath/assets/js/main.js');
    vi.mocked(glob.sync).mockReturnValue(['/project/src/mocks/handlers.ts']);
    expect(htmlPlugin('/subpath', context('eshn')).transformIndexHtml(html)).toContain('mock-api');
  });
  it('does not rewrite inline script data and handles queries or unquoted src attributes', () => {
    const hook = htmlPlugin('/', context('production'));

    expect(hook.transformIndexHtml('<p>no mocks</p>')).toBe('<p>no mocks</p>');
    const inline = '<script type="application/json">{"example":"<script src=\\"/assets/js/mock-api.js\\">"}</script>';

    expect(hook.transformIndexHtml(inline)).toBe(inline);
    expect(hook.transformIndexHtml('<script src=/assets/js/mock-api.js?v=1></script><script src=""></script>')).not.toContain('mock-api.js');
  });

  it('isolates *.entry.* dependency graphs and rejects cross-entry imports', async () => {
    expect(getEntryOwner('/project/src/assets/scripts/Header.entry.ts')).toBe('header');
    expect(getEntryOwner('/project/src/assets/scripts/shared.ts?alveo-entry=header')).toBe('header');
    expect(getEntryOwner('/project/src/organisms/header/index.tsx')).toBeUndefined();

    expect(() => assertNotCrossEntryImport('/project/src/a.entry.ts', '/project/src/a.entry.ts')).not.toThrow();
    expect(() => assertNotCrossEntryImport('/project/src/b.entry.ts', '/project/src/a.entry.ts')).toThrow(
      'Entry script "/project/src/b.entry.ts" cannot be imported by "/project/src/a.entry.ts".'
    );

    const resolve = vi.fn(async (source: string) => {
      if (source === 'unresolved') return null;
      if (source === 'external-pkg') return { id: 'external-pkg', external: true };
      if (source === 'virtual') return { id: '\0rolldown/runtime.js' };
      if (source === 'virtual-fn') return { id: '\0virtual:alveo/functions' };
      if (source === './already') return { id: '/project/src/already.ts?alveo-entry=main' };
      if (source === './icon.svg?url') return { id: '/project/src/icon.svg?url' };
      if (source === './logo.svg') return { id: '/project/src/logo.svg' };
      if (source === './shared.ts?v=1') return { id: '/project/src/shared.ts?v=1' };
      if (source === './other.entry') return { id: '/project/src/other.entry.ts' };

      return { id: `/project/src/${source.replace('./', '')}.ts` };
    });

    expect(await resolveEntryIsolatedId(resolve, './shared', undefined)).toBeUndefined();
    expect(await resolveEntryIsolatedId(resolve, './shared', '/project/src/organisms/header.tsx')).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();

    await expect(resolveEntryIsolatedId(resolve, './other.entry', '/project/src/organisms/header.tsx')).rejects.toThrow(
      'Entry script "/project/src/other.entry.ts" cannot be imported by "/project/src/organisms/header.tsx".'
    );
    expect(await resolveEntryIsolatedId(resolve, 'unresolved', '/project/src/main.entry.ts')).toBeUndefined();
    expect(await resolveEntryIsolatedId(resolve, 'external-pkg', '/project/src/main.entry.ts')).toBeUndefined();
    expect(await resolveEntryIsolatedId(resolve, 'virtual', '/project/src/main.entry.ts')).toEqual({ id: '\0rolldown/runtime.js' });
    expect(await resolveEntryIsolatedId(resolve, 'virtual-fn', '/project/src/main.entry.ts')).toEqual({
      id: '\0virtual:alveo/functions?alveo-entry=main',
    });
    expect(await resolveEntryIsolatedId(resolve, './already', '/project/src/main.entry.ts')).toEqual({
      id: '/project/src/already.ts?alveo-entry=main',
    });
    expect(await resolveEntryIsolatedId(resolve, './shared', '/project/src/main.entry.ts', undefined, false)).toBeUndefined();
    expect(await resolveEntryIsolatedId(resolve, './shared', '/project/src/main.entry.ts')).toEqual({
      id: '/project/src/shared.ts?alveo-entry=main',
    });
    expect(await resolveEntryIsolatedId(resolve, './shared.ts?v=1', '/project/src/shared.ts?alveo-entry=main')).toEqual({
      id: '/project/src/shared.ts?v=1&alveo-entry=main',
    });
    // Asset URLs and non-script files must not have `?alveo-entry=` appended to emitted asset paths.
    expect(await resolveEntryIsolatedId(resolve, './icon.svg?url', '/project/src/shared.ts?alveo-entry=main')).toEqual({
      id: '/project/src/icon.svg?url',
    });
    expect(await resolveEntryIsolatedId(resolve, './logo.svg', '/project/src/shared.ts?alveo-entry=main')).toEqual({
      id: '/project/src/logo.svg',
    });

    const hook = plugin();
    const resolveContext = { resolve: vi.fn().mockResolvedValue({ id: '/project/src/helper.ts' }) };

    await expect(hook.resolveId.call(resolveContext, './helper', '/project/src/header.entry.ts', {})).resolves.toEqual({
      id: '/project/src/helper.ts?alveo-entry=header',
    });
  });

  it('inlines residual entry chunk imports and prunes unreferenced intermediate chunks', async () => {
    const cleanBundle: OutputBundleLike = {
      'assets/js/main.js': {
        type: 'chunk',
        fileName: 'assets/js/main.js',
        isEntry: true,
        facadeModuleId: '/project/src/main.entry.ts',
        imports: [],
        dynamicImports: [],
        code: 'globalThis.main=1;',
      },
    };

    await inlineBundleEntryImports(cleanBundle, false);
    expect(Object.keys(cleanBundle)).toEqual(['assets/js/main.js']);

    const bundle: OutputBundleLike = {
      'assets/js/transitive-helper.0x99999999.js': {
        type: 'chunk',
        fileName: 'assets/js/transitive-helper.0x99999999.js',
        isEntry: false,
        imports: [],
        dynamicImports: [],
        code: 'export const step = (v) => v + 1;\n',
      },
      'assets/js/transitive-helper.0x99999999.js.map': {
        type: 'asset',
        fileName: 'assets/js/transitive-helper.0x99999999.js.map',
        source: '{}',
      },
      'assets/js/rolldown-runtime.0x12345678.js': {
        type: 'chunk',
        fileName: 'assets/js/rolldown-runtime.0x12345678.js',
        isEntry: false,
        imports: ['assets/js/transitive-helper.0x99999999.js'],
        dynamicImports: [],
        code: 'import { step } from "./transitive-helper.0x99999999.js"; export const rt = (v) => step(v);\n//# sourceMappingURL=rolldown-runtime.0x12345678.js.map',
      },
      'assets/js/rolldown-runtime.0x12345678.js.map': {
        type: 'asset',
        fileName: 'assets/js/rolldown-runtime.0x12345678.js.map',
        source: '{}',
      },
      'assets/js/dyn.0x87654321.js': {
        type: 'chunk',
        fileName: 'assets/js/dyn.0x87654321.js',
        isEntry: false,
        isDynamicEntry: true,
        imports: [],
        dynamicImports: [],
        code: 'export const d = 40;\n',
        map: {
          version: 3,
          sources: ['../../../src/dyn.ts'],
          sourcesContent: ['export const d = 40;\r\n'],
          names: [],
          mappings: 'AAAA',
        },
      },
      'assets/js/main.js': {
        type: 'chunk',
        fileName: 'assets/js/main.js',
        isEntry: true,
        facadeModuleId: '/project/src/main.entry.ts',
        imports: ['assets/js/rolldown-runtime.0x12345678.js'],
        dynamicImports: ['assets/js/dyn.0x87654321.js'],
        code: 'import "external-cdn"; import "./external-relative.js"; import { rt } from "./rolldown-runtime.0x12345678.js"; import("./dyn.0x87654321.js").then(m => { globalThis.total = rt(m.d); });\n//# sourceMappingURL=main.js.map',
        map: {
          version: 3,
          sources: ['../../../src/main.entry.ts'],
          sourcesContent: ['globalThis.total = 41;\r\n'],
          names: ['total'],
          mappings: 'AAAA',
        },
      },
      'assets/js/main.js.map': {
        type: 'asset',
        fileName: 'assets/js/main.js.map',
        source: '{}',
      },
      'assets/js/react-loader.0xaaaaaaaa.js': {
        type: 'chunk',
        fileName: 'assets/js/react-loader.0xaaaaaaaa.js',
        isEntry: true,
        facadeModuleId: '/project/index.html',
        imports: ['assets/js/rolldown-runtime.0x12345678.js', 'assets/js/shared-context.0xcccccccc.js'],
        dynamicImports: ['assets/js/people.0xbbbbbbbb.js'],
        code: 'import { rt } from "./rolldown-runtime.0x12345678.js"; import { ctx } from "./shared-context.0xcccccccc.js"; export const load = () => import("./people.0xbbbbbbbb.js"); export const v = rt(ctx);',
      },
      'assets/js/shared-context.0xcccccccc.js': {
        type: 'chunk',
        fileName: 'assets/js/shared-context.0xcccccccc.js',
        isEntry: false,
        isDynamicEntry: false,
        imports: [],
        dynamicImports: [],
        code: 'export const ctx = 1;',
      },
      'assets/js/people.0xbbbbbbbb.js': {
        type: 'chunk',
        fileName: 'assets/js/people.0xbbbbbbbb.js',
        isEntry: false,
        isDynamicEntry: true,
        imports: ['assets/js/shared-context.0xcccccccc.js'],
        dynamicImports: [],
        code: 'import { ctx } from "./shared-context.0xcccccccc.js"; export default ctx;',
      },
    };

    const hook = plugin();
    const nullContentMap = {
      version: 3,
      sources: ['a.ts', 'b.ts'],
      sourcesContent: ['const a = 1;\r\n', null] as unknown as string[],
      names: [],
      mappings: 'AAAA',
    };
    const nullContentBundle: OutputBundleLike = {
      'assets/js/rolldown-runtime.0x12345678.js': {
        type: 'chunk',
        fileName: 'assets/js/rolldown-runtime.0x12345678.js',
        isEntry: false,
        imports: [],
        dynamicImports: [],
        code: 'export const rt = (v) => v + 1;',
      },
      'assets/js/main.js': {
        type: 'chunk',
        fileName: 'assets/js/main.js',
        isEntry: true,
        facadeModuleId: '/project/src/main.entry.ts',
        imports: ['assets/js/rolldown-runtime.0x12345678.js'],
        dynamicImports: [],
        code: 'import { rt } from "./rolldown-runtime.0x12345678.js"; globalThis.v = rt(1);',
      },
    };

    await inlineBundleEntryImports(
      nullContentBundle,
      true,
      vi.fn().mockResolvedValue({
        output: [{ type: 'chunk', code: 'globalThis.v=2;\r\n', map: nullContentMap, imports: [], dynamicImports: [] }],
      }) as unknown as typeof import('rolldown').build
    );
    expect((nullContentBundle['assets/js/main.js'] as { map?: { sourcesContent?: Array<string | null> } }).map?.sourcesContent).toEqual([
      'const a = 1;\n',
      null,
    ]);

    await hook.generateBundle({ sourcemap: true }, bundle);
    const mainChunk = bundle['assets/js/main.js'];

    expect(mainChunk).toMatchObject({
      type: 'chunk',
      imports: [],
      dynamicImports: [],
    });
    if (mainChunk?.type === 'chunk') {
      expect(mainChunk.code).not.toContain('rolldown-runtime');
      expect(mainChunk.code).toContain('external-cdn');
      expect(mainChunk.map?.sourcesContent?.join('\n')).not.toContain('\r');
    }
    const mainMapAsset = bundle['assets/js/main.js.map'];

    expect(mainMapAsset?.type).toBe('asset');
    if (mainMapAsset?.type === 'asset' && mainChunk?.type === 'chunk') {
      const mapText = String(mainMapAsset.source);

      expect(mapText).not.toContain('\\r');
      const consumer = new SourceMapConsumer(JSON.parse(mapText));
      const totalIndex = mainChunk.code.indexOf('total');
      const mapped = consumer.originalPositionFor({ line: 1, column: totalIndex });

      expect(mapped.source).toContain('src/main.entry.ts');
      expect(mapped.line).toBe(1);
    }
    const loaderChunk = bundle['assets/js/react-loader.0xaaaaaaaa.js'];

    expect(loaderChunk).toMatchObject({
      type: 'chunk',
      imports: ['assets/js/shared-context.0xcccccccc.js'],
      dynamicImports: ['assets/js/people.0xbbbbbbbb.js'],
    });
    expect(bundle['assets/js/rolldown-runtime.0x12345678.js']).toBeUndefined();
    expect(bundle['assets/js/rolldown-runtime.0x12345678.js.map']).toBeUndefined();
    expect(bundle['assets/js/transitive-helper.0x99999999.js']).toBeUndefined();
    expect(bundle['assets/js/transitive-helper.0x99999999.js.map']).toBeUndefined();
    expect(bundle['assets/js/dyn.0x87654321.js']).toBeUndefined();
    // Shared stateful/context chunks between React components stay a single instance.
    expect(bundle['assets/js/shared-context.0xcccccccc.js']).toBeDefined();
    expect(bundle['assets/js/people.0xbbbbbbbb.js']).toMatchObject({
      type: 'chunk',
      imports: ['assets/js/shared-context.0xcccccccc.js'],
    });

    // Preserve `'inline'`, `'hidden'`, and omitted sourcemap modes.
    for (const [mode, hasInlineDataUrl, hasMapLink] of [
      ['inline', true, true],
      ['hidden', false, false],
      [undefined, false, false],
    ] as const) {
      const modeBundle: OutputBundleLike = {
        'assets/js/rolldown-runtime.0x12345678.js': {
          type: 'chunk',
          fileName: 'assets/js/rolldown-runtime.0x12345678.js',
          isEntry: false,
          imports: [],
          dynamicImports: [],
          code: 'export const rt = (v) => v + 1;',
        },
        'assets/js/main.js': {
          type: 'chunk',
          fileName: 'assets/js/main.js',
          isEntry: true,
          facadeModuleId: '/project/src/main.entry.ts',
          imports: ['assets/js/rolldown-runtime.0x12345678.js'],
          dynamicImports: [],
          code: 'import { rt } from "./rolldown-runtime.0x12345678.js"; globalThis.v = rt(1);',
        },
      };

      await hook.generateBundle({ sourcemap: mode }, modeBundle);
      const flattenedMain = modeBundle['assets/js/main.js'];

      expect(flattenedMain?.type).toBe('chunk');
      if (flattenedMain?.type === 'chunk') {
        expect(flattenedMain.code.includes('sourceMappingURL=data:application/json')).toBe(hasInlineDataUrl);
        expect(flattenedMain.code.includes('sourceMappingURL=')).toBe(hasMapLink);
      }
    }
  });
});
