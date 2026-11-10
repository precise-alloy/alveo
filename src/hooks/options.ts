import type { ExistingRawSourceMap, OutputAsset, OutputChunk } from 'rolldown';
import type { PluginOption } from 'vite';
import type { AlveoContext } from './types.ts';

import path from 'path';
import fs from 'node:fs';

import { glob } from 'glob';
import { build as rolldownBuild } from 'rolldown';
import slash from 'slash';

import { getPackageRoot } from '../paths.ts';
import { getScriptEntryName, isScriptEntry, SCRIPT_ENTRY_IGNORE_PATTERNS } from '../filename.ts';
import { normalizeTextLikeContent, normalizeTextLineEndings } from '../text-normalization.ts';

export interface ResolveResult {
  id: string;
  external?: boolean | 'absolute' | 'relative';
}

export type ResolveFunction = (
  source: string,
  importer?: string,
  options?: { assertions?: Record<string, string>; custom?: Record<string, unknown>; isEntry?: boolean; skipSelf?: boolean }
) => Promise<ResolveResult | null> | ResolveResult | null;

export interface BundleChunkLike {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  isDynamicEntry?: boolean;
  facadeModuleId?: string | null;
  imports: string[];
  dynamicImports: string[];
  code: string;
  map?: ExistingRawSourceMap | null;
}

export interface BundleAssetLike {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}

export type OutputBundleLike = Record<string, BundleChunkLike | BundleAssetLike>;

const ENTRY_OWNER_REGEX = /(?:^|&)alveo-entry=([^&]+)/;
const ISOLATABLE_MODULE_REGEX = /\.[cm]?[jt]sx?$|\.json$/i;
const ASSET_QUERY_REGEX = /(?:^|&)(?:url|raw|inline|worker|sharedworker)(?:&|=|$)/;

const shouldIsolateModule = (resolvedId: string, cleanResolved: string, query: string): boolean => {
  if (ENTRY_OWNER_REGEX.test(query) || ASSET_QUERY_REGEX.test(query)) {
    return false;
  }

  if (resolvedId.startsWith('\0')) {
    return resolvedId.startsWith('\0virtual:alveo/');
  }

  return ISOLATABLE_MODULE_REGEX.test(cleanResolved);
};

export const isMockApiEnabled = (context: AlveoContext): boolean =>
  context.mode !== 'production' && glob.sync(`${context.projectRoot}/src/mocks/handlers{,/index}.{js,jsx,ts,tsx}`).length > 0;

/**
 * Determines which standalone `*.entry.*` script owns the current module in the
 * import chain, either from an inherited `?alveo-entry=<owner>` tag or because
 * the importer itself is a `*.entry.*` file.
 */
export const getEntryOwner = (importer: string): string | undefined => {
  const [cleanImporter = '', importerQuery = ''] = importer.split('?', 2);
  const ownerMatch = ENTRY_OWNER_REGEX.exec(importerQuery);

  if (ownerMatch) {
    return decodeURIComponent(ownerMatch[1]!);
  }

  return isScriptEntry(cleanImporter) ? getScriptEntryName(cleanImporter) : undefined;
};

/**
 * Rejects imports that target another standalone `*.entry.*` script. CMS pages
 * load component entry files in arbitrary combinations and order, so entries
 * must never depend on each other; shared logic belongs in helper modules.
 */
export const assertNotCrossEntryImport = (resolvedPath: string, importerPath: string): void => {
  const cleanResolved = slash(resolvedPath.split('?', 1)[0]!);
  const cleanImporter = slash(importerPath.split('?', 1)[0]!);

  if (isScriptEntry(cleanResolved) && cleanResolved !== cleanImporter) {
    throw new Error(`Entry script "${cleanResolved}" cannot be imported by "${cleanImporter}".`);
  }
};

/**
 * Isolates every module imported within a standalone `*.entry.*` dependency
 * subgraph by tagging its resolved ID with `?alveo-entry=<owner>`. This causes
 * Rolldown to inline shared helpers into each entry bundle instead of extracting
 * cross-entry shared chunks that would require extra network round-trips.
 */
export const resolveEntryIsolatedId = async (
  resolve: ResolveFunction,
  source: string,
  importer?: string,
  resolveOptions?: { assertions?: Record<string, string>; custom?: Record<string, unknown>; isEntry?: boolean },
  isolate = true
): Promise<ResolveResult | undefined> => {
  if (!importer) {
    return undefined;
  }

  const owner = isolate ? getEntryOwner(importer) : undefined;

  if (!owner && !source.includes('.entry')) {
    return undefined;
  }

  const cleanImporter = importer.split('?', 1)[0]!;
  const resolved = await resolve(source, cleanImporter, { ...resolveOptions, skipSelf: true });

  if (!resolved || resolved.external) {
    return undefined;
  }

  const [cleanResolved = '', query = ''] = resolved.id.split('?', 2);

  assertNotCrossEntryImport(cleanResolved, cleanImporter);

  if (!owner || !shouldIsolateModule(resolved.id, cleanResolved, query)) {
    return resolved;
  }

  const encodedOwner = encodeURIComponent(owner);
  const nextQuery = query ? `${query}&alveo-entry=${encodedOwner}` : `alveo-entry=${encodedOwner}`;

  return { ...resolved, id: `${cleanResolved}?${nextQuery}` };
};

const ROLLDOWN_RUNTIME_CHUNK_REGEX = /(?:^|\/)rolldown-runtime\.0x[a-z0-9_-]{8,12}\.js$/i;

const getChunkFlattenMode = (chunk: BundleChunkLike, bundle: OutputBundleLike): 'standalone' | 'loader-runtime' | undefined => {
  const isStandaloneEntry = chunk.isEntry && Boolean(chunk.facadeModuleId && isScriptEntry(chunk.facadeModuleId));

  if (isStandaloneEntry) {
    return chunk.imports.length > 0 || chunk.dynamicImports.length > 0 ? 'standalone' : undefined;
  }

  // Only inline the stateless `rolldown-runtime` CJS helper into `react-loader`.
  // Shared chunks between lazy React components (such as React contexts or stores)
  // must keep their single shared chunk instance to preserve module identity.
  const isReactLoader = chunk.isEntry && chunk.fileName.startsWith('assets/js/react-loader.');
  const hasRuntimeImport = chunk.imports.some((imp) => ROLLDOWN_RUNTIME_CHUNK_REGEX.test(imp) && bundle[imp]?.type === 'chunk');

  return isReactLoader && hasRuntimeImport ? 'loader-runtime' : undefined;
};

const shouldInlineImport = (targetKey: string, mode: 'standalone' | 'loader-runtime', bundle: OutputBundleLike): boolean =>
  bundle[targetKey]?.type === 'chunk' && (mode === 'standalone' || ROLLDOWN_RUNTIME_CHUNK_REGEX.test(targetKey));

const pruneUnreferencedChunks = (bundle: OutputBundleLike): void => {
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === 'chunk' && item.isEntry) {
      reachable.add(fileName);
      queue.push(fileName);
    }
  }

  while (queue.length > 0) {
    // Only verified `type === 'chunk'` keys are enqueued.
    const current = bundle[queue.pop()!] as BundleChunkLike;

    for (const target of [...current.imports, ...current.dynamicImports]) {
      if (!reachable.has(target) && bundle[target]?.type === 'chunk') {
        reachable.add(target);
        queue.push(target);
      }
    }
  }

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === 'chunk' && !reachable.has(fileName)) {
      delete bundle[fileName];
      delete bundle[fileName + '.map'];
    }
  }
};

const normalizeChunkSourceMap = (map: ExistingRawSourceMap | null | undefined): ExistingRawSourceMap | null | undefined => {
  if (!map?.sourcesContent) return map;

  return {
    ...map,
    sourcesContent: map.sourcesContent.map((content) => (typeof content === 'string' ? normalizeTextLineEndings(content) : content)),
  };
};

/**
 * Flattens any residual chunk imports (such as CommonJS `rolldown-runtime` or
 * entry-local dynamic imports) into standalone entry chunks so every emitted
 * `*.entry.*` file in `assets/js/` is 100% self-contained, and inlines the
 * stateless `rolldown-runtime` helper into `react-loader` when present.
 */
export const inlineBundleEntryImports = async (
  bundle: OutputBundleLike,
  sourcemap: boolean | 'inline' | 'hidden' = false,
  buildFn: typeof rolldownBuild = rolldownBuild
): Promise<void> => {
  let flattenedAny = false;

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type !== 'chunk') continue;
    const mode = getChunkFlattenMode(item, bundle);

    if (!mode) continue;
    flattenedAny = true;
    const result = await buildFn({
      input: '/' + fileName,
      write: false,
      plugins: [
        {
          name: 'alveo-memory-bundle',
          resolveId(source, importer) {
            if (!importer) return source;
            if (!source.startsWith('.') && !source.startsWith('/')) {
              return { id: source, external: true };
            }
            const resolved = path.posix.resolve(path.posix.dirname(importer), source);

            if (!shouldInlineImport(resolved.slice(1), mode, bundle)) {
              return { id: source, external: true };
            }

            return resolved;
          },
          load(id) {
            // Every non-external module in the in-memory pass is a verified chunk in `bundle`.
            const candidate = bundle[id.slice(1)] as BundleChunkLike;

            return {
              code: candidate.code.replace(/\/\/# sourceMappingURL=.*$/m, ''),
              map: candidate.map ?? undefined,
            };
          },
        },
      ],
      output: {
        file: path.posix.basename(fileName),
        format: 'es',
        minify: true,
        sourcemap,
        codeSplitting: false,
      },
    });
    // A single-input Rolldown build with `codeSplitting: false` always emits one entry chunk.
    const outChunk = result.output.find((entry): entry is OutputChunk => entry.type === 'chunk')!;
    const outMap = result.output.find((entry): entry is OutputAsset => entry.type === 'asset');

    item.code = normalizeTextLineEndings(outChunk.code);
    item.map = normalizeChunkSourceMap(outChunk.map);
    item.imports = mode === 'standalone' ? [] : item.imports.filter((imp) => !ROLLDOWN_RUNTIME_CHUNK_REGEX.test(imp));
    if (mode === 'standalone') item.dynamicImports = [];
    const mapAsset = bundle[fileName + '.map'];

    if (outMap && mapAsset?.type === 'asset') {
      mapAsset.source = normalizeTextLikeContent(fileName + '.map', Buffer.from(outMap.source));
    }
  }

  if (flattenedAny) {
    pruneUnreferencedChunks(bundle);
  }
};

const options = (context: AlveoContext): PluginOption => {
  const scriptOnly = process.env.scriptOnly;

  const getSiteInputs = (): Record<string, string> => {
    const inputs: Record<string, string> = {};
    const packageRoot = getPackageRoot();

    if (!scriptOnly) {
      inputs['index'] = `${context.projectRoot}/index.html`;
    }

    // Scan consumer's entry files and alveo package's own script entries.
    // All patterns must be absolute — glob's `root` option rewrites
    // `/`-prefixed patterns on Linux, which corrupts absolute packageRoot paths.
    const frameworkScripts = fs.existsSync(path.join(packageRoot, 'dist/scripts'))
      ? 'dist/scripts/**/*.entry.js'
      : 'src/scripts/**/*.entry.{js,jsx,ts,tsx}';
    // Use the same exclusions as the standalone script build so test/spec
    // entries and __tests__/__mocks__ fixtures never become Vite inputs.
    const filePaths = glob.sync([`${context.projectRoot}/src/assets/**/*.entry.{js,jsx,ts,tsx}`, `${packageRoot}/${frameworkScripts}`], {
      ignore: [...SCRIPT_ENTRY_IGNORE_PATTERNS],
    });

    [].forEach.call(filePaths, (filePath: string) => {
      const entryName = getScriptEntryName(filePath);

      if (entryName === 'mock-api' && !isMockApiEnabled(context)) {
        return;
      }

      // Own-property check: names such as `constructor.entry.ts` must not
      // collide with Object.prototype members on this plain record.
      if (Object.hasOwn(inputs, entryName)) {
        throw new Error(`Duplicate script entry "${entryName}": ${inputs[entryName]} and ${filePath}`);
      }

      inputs[entryName] = filePath;
    });

    return inputs;
  };

  return {
    name: 'alveo-options',
    enforce: 'pre',

    options(options) {
      if (typeof options.input === 'string' && options.input.includes('entry-server')) {
        return options;
      }

      options.input = getSiteInputs();
    },

    resolveId(source, importer, resolveOptions) {
      return resolveEntryIsolatedId(this.resolve.bind(this), source, importer, resolveOptions);
    },

    async generateBundle(outputOptions, bundle) {
      await inlineBundleEntryImports(bundle as unknown as OutputBundleLike, outputOptions.sourcemap ?? false);
    },
  };
};

export default options;
