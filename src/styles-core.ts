import type { Stats } from 'fs';
import type { ChokidarOptions } from 'chokidar';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import slash from 'slash';
import { RawSourceMap, SourceMapConsumer, SourceMapGenerator } from 'source-map-js';
import { transform as lightningTransform, type Targets } from 'lightningcss';

import { normalizeTextLikeContent, normalizeTextLineEndings } from './text-normalization.ts';

export function createStyleBundleSource(entry: string, components: string[]): { contents: string; url: URL } {
  // A synthetic entry contains only @use rules, in cascade order. Each real
  // module is loaded through the prelude-aware importer exactly once. Appending
  // compiled CSS loses source ownership; appending @use after CSS is invalid.
  const files = [entry, ...sortStylePaths(components).filter((file) => !path.basename(file).startsWith('_'))];

  return {
    // Relative imports also avoid treating a Windows drive letter as a URL
    // scheme in the custom importer.
    contents: files
      .map((file, index) => `@use ${JSON.stringify('./' + slash(path.relative(path.dirname(entry), file)))} as alveo_${index};`)
      .join('\n'),
    url: pathToFileURL(path.join(path.dirname(entry), '.alveo-' + path.basename(entry))),
  };
}

export function transformStyleCss(
  css: string,
  sourceMap: RawSourceMap,
  filename: string,
  targets: Targets,
  transform: typeof lightningTransform = lightningTransform
): { css: string; map: string } {
  const result = transform({
    filename: slash(filename),
    code: Buffer.from(normalizeTextLineEndings(css).replace(/^\uFEFF/, '')),
    minify: true,
    sourceMap: true,
    inputSourceMap: JSON.stringify(sourceMap),
    targets,
    errorRecovery: true,
  });

  if (result.warnings.length > 0) throw new AggregateError(result.warnings, `LightningCSS warnings in ${filename}`);
  if (!result.map) throw new Error(`LightningCSS did not produce a source map for ${filename}`);

  const output = normalizeTextLineEndings(Buffer.from(result.code).toString('utf8'));
  const leaks = output.match(/\b(?:px2rem|px2em|rtl|str-replace|div)\(/g);

  if (leaks) throw new Error(`Unevaluated Sass functions in ${filename}: ${[...new Set(leaks)].join(', ')}`);

  return { css: output, map: normalizeTextLikeContent(filename + '.map', Buffer.from(result.map)).toString() };
}

export interface StyleCoreDependencies {
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
}

const defaultDependencies: StyleCoreDependencies = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
};

const STYLE_WATCH_POLL_INTERVAL_MS = 200;
const DEFAULT_STYLE_COMPILE_CONCURRENCY = 5;

export const getStyleCompileConcurrency = (value: string | undefined = process.env.STYLES_CONCURRENCY): number => {
  const parsed = value && value.trim() !== '' ? Number(value) : DEFAULT_STYLE_COMPILE_CONCURRENCY;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_STYLE_COMPILE_CONCURRENCY;
};

export const createStyleCompileQueue = (concurrency: number) => {
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  const queuedTasks: Array<() => void> = [];
  const pendingTasks = new Set<Promise<unknown>>();
  let activeCount = 0;

  const startNext = () => {
    while (activeCount < maxConcurrency && queuedTasks.length > 0) {
      queuedTasks.shift()?.();
    }
  };

  const add = (task: () => unknown | Promise<unknown>) => {
    let taskPromise: Promise<unknown>;

    taskPromise = new Promise((resolve, reject) => {
      queuedTasks.push(() => {
        activeCount += 1;

        const settleTask = (settle: () => void) => {
          activeCount -= 1;
          pendingTasks.delete(taskPromise);
          startNext();
          settle();
        };

        Promise.resolve()
          .then(task)
          .then(
            (value) => settleTask(() => resolve(value)),
            (error: unknown) => settleTask(() => reject(error))
          );
      });
    });

    pendingTasks.add(taskPromise);
    startNext();

    return taskPromise;
  };

  const drain = async () => {
    while (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
  };

  return {
    add,
    drain,
    getActiveCount: () => activeCount,
    getPendingCount: () => pendingTasks.size,
    getQueuedCount: () => queuedTasks.length,
  };
};

export const isStyleWatchIgnored = (filePath: string, stats?: Pick<Stats, 'isFile'>): boolean => {
  return !!stats?.isFile() && !filePath.endsWith('.scss');
};

export const getStyleWatchOptions = (): ChokidarOptions => {
  return {
    ignored: isStyleWatchIgnored,
    ignoreInitial: true,
    // Native file events are not reliable for every editor/remote-volume path
    // this workspace is used through; when they are missed, Sass sources change
    // but `public/assets/css/*.css` stays stale until a manual `touch`. Polling
    // keeps watch mode deterministic, and the interval matches the compile
    // debounce so quick save bursts are still coalesced before Sass runs.
    usePolling: true,
    interval: STYLE_WATCH_POLL_INTERVAL_MS,
    awaitWriteFinish: {
      stabilityThreshold: STYLE_WATCH_POLL_INTERVAL_MS,
      pollInterval: STYLE_WATCH_POLL_INTERVAL_MS / 2,
    },
  };
};

export const sortStylePaths = (paths: string[]): string[] => {
  return [...paths].sort((left, right) => {
    const normalizedLeft = slash(left);
    const normalizedRight = slash(right);

    if (normalizedLeft === normalizedRight) {
      return 0;
    }

    return normalizedLeft < normalizedRight ? -1 : 1;
  });
};

/**
 * Prepends `@use` declarations for the consumer's abstracts, functions, and
 * mixins barrels to a SCSS source file. All paths are resolved relative to
 * the consumer's project root.
 *
 * @param projectRoot - Absolute path to the consumer project's root directory
 */
export const prepareCssFileContent = (
  {
    srcFile,
    projectRoot,
    includeMixins = true,
    includeAbstracts = true,
    includeFunctions = true,
  }: {
    srcFile: string;
    projectRoot: string;
    includeMixins?: boolean;
    includeAbstracts?: boolean;
    includeFunctions?: boolean;
  },
  dependencies: Pick<StyleCoreDependencies, 'readFileSync'> = defaultDependencies
): string[] => {
  const abstractsPath = path.resolve(projectRoot, 'src/assets/styles/00-abstracts/abstracts');
  const functionsPath = path.resolve(projectRoot, 'src/assets/styles/01-functions/functions');
  const mixinsPath = path.resolve(projectRoot, 'src/assets/styles/01-mixins/mixins');

  return [
    includeAbstracts ? slash(`@use '${path.relative(path.dirname(srcFile), abstractsPath)}' as *;\n`) : undefined,
    includeFunctions ? slash(`@use '${path.relative(path.dirname(srcFile), functionsPath)}' as *;\n`) : undefined,
    includeMixins ? slash(`@use '${path.relative(path.dirname(srcFile), mixinsPath)}' as *;\n`) : undefined,
    dependencies.readFileSync(srcFile, 'utf-8'),
  ].filter((content): content is string => content !== undefined);
};

export const createScssImporterResult = (filePath: string, contents: string) => {
  return {
    contents,
    syntax: 'scss' as const,
    // Sass falls back to embedding importer-provided sources as `data:` URLs
    // when `sourceMapUrl` is omitted. That makes DevTools show imported SCSS
    // partials under synthetic `data:` filenames instead of the real file on
    // disk. We still return the prelude-injected contents here so compilation
    // sees the shared mixins/functions, but we pin the sourcemap identity to
    // the actual file URL so `stripInjectedPreludeFromSourceMap()` can later
    // remove the synthetic prelude lines while keeping the original filename.
    sourceMapUrl: pathToFileURL(path.resolve(filePath)),
  };
};

const fileUrlToPath = (url: URL): string => {
  decodeURI(url.href);

  return fileURLToPath(url);
};

const normalizeSourceMapFilePath = (filePath: string): string => {
  const normalized = slash(filePath);

  return normalized.replace(/^\/([a-zA-Z]:\/)/, '$1');
};

export const getRelativeSourceMapPath = (filePath: string, projectRoot: string = path.resolve('.')): string => {
  const normalizedFilePath = normalizeSourceMapFilePath(filePath);
  const normalizedProjectRoot = normalizeSourceMapFilePath(projectRoot).replace(/\/$/, '');

  if (normalizedFilePath === normalizedProjectRoot) {
    return '.';
  }

  if (normalizedFilePath.startsWith(`${normalizedProjectRoot}/`)) {
    return normalizedFilePath.slice(normalizedProjectRoot.length + 1);
  }

  return normalizedFilePath;
};

export const resolveSourceMapPath = (source: string, sourceRoot?: string | null): string | undefined => {
  const isWindowsDrivePath = (value: string) => /^[a-zA-Z]:[\\/]/.test(value);
  const isAbsoluteFileSystemPath = (value: string) => {
    const normalizedValue = slash(value);

    return normalizedValue.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedValue);
  };

  if (source.startsWith('data:')) {
    return undefined;
  }

  try {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source) && !isWindowsDrivePath(source)) {
      return fileUrlToPath(new URL(source));
    }

    if (sourceRoot && /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(sourceRoot) && !isWindowsDrivePath(sourceRoot)) {
      return fileUrlToPath(new URL(source, sourceRoot));
    }
  } catch {
    return undefined;
  }

  if (isAbsoluteFileSystemPath(source)) {
    return normalizeSourceMapFilePath(source);
  }

  return path.resolve(sourceRoot ?? '.', source);
};

export const stripInjectedPreludeFromSourceMap = (
  sourceMap: RawSourceMap,
  dependencies: StyleCoreDependencies = defaultDependencies,
  { projectRoot = path.resolve('.') }: { projectRoot?: string } = {}
): RawSourceMap => {
  const consumer = new SourceMapConsumer(sourceMap);
  const generator = new SourceMapGenerator({
    file: sourceMap.file,
    sourceRoot: sourceMap.sourceRoot,
  });
  const sourceLineOffsets = new Map<string, number>();
  const normalizedSources = new Map<string, string>();

  consumer.sources.forEach((source) => {
    const sourceContent = consumer.sourceContentFor(source, true);
    const filePath = resolveSourceMapPath(source, consumer.sourceRoot);
    const normalizedSource = filePath ? getRelativeSourceMapPath(filePath, projectRoot) : source;
    const normalizedSourceContent = typeof sourceContent === 'string' ? normalizeTextLineEndings(sourceContent) : sourceContent;

    normalizedSources.set(source, normalizedSource);

    if (!filePath || !normalizedSourceContent || !dependencies.existsSync(filePath)) {
      generator.setSourceContent(normalizedSource, normalizedSourceContent ?? undefined);

      return;
    }

    const realSourceContent = normalizeTextLineEndings(dependencies.readFileSync(filePath, 'utf-8'));

    if (!normalizedSourceContent.endsWith(realSourceContent)) {
      generator.setSourceContent(normalizedSource, normalizedSourceContent);

      return;
    }

    const injectedPrelude = normalizedSourceContent.slice(0, normalizedSourceContent.length - realSourceContent.length);
    const lineOffset = injectedPrelude.match(/\n/g)?.length ?? 0;

    if (lineOffset > 0) {
      sourceLineOffsets.set(source, lineOffset);
    }

    generator.setSourceContent(normalizedSource, realSourceContent);
  });

  consumer.eachMapping((mapping) => {
    const generated = {
      line: mapping.generatedLine,
      column: mapping.generatedColumn,
    };

    if (!mapping.source || mapping.originalLine == null || mapping.originalColumn == null) {
      generator.addMapping({
        generated,
        name: mapping.name ?? undefined,
      });

      return;
    }

    const lineOffset = sourceLineOffsets.get(mapping.source) ?? 0;
    const originalLine = mapping.originalLine - lineOffset;

    if (originalLine < 1) {
      return;
    }

    generator.addMapping({
      generated,
      original: {
        line: originalLine,
        column: mapping.originalColumn,
      },
      /* v8 ignore next -- defensive: eachMapping always references a source from consumer.sources */
      source: normalizedSources.get(mapping.source) ?? mapping.source,
      name: mapping.name ?? undefined,
    });
  });

  return generator.toJSON();
};

export const getStylesOutputFileName = (
  srcFile: string,
  { organismPrefix = 'b-', templatePrefix = 'p-' }: { organismPrefix?: string; templatePrefix?: string } = {}
): string | undefined => {
  if (path.basename(srcFile).startsWith('_')) {
    return undefined;
  }

  const name =
    path.basename(srcFile) === 'index.scss' ? path.basename(path.dirname(srcFile)) + '.css' : path.basename(srcFile).replace(/\.scss$/, '.css');

  if (srcFile.includes('organisms')) {
    return organismPrefix + name;
  }

  if (srcFile.includes('templates')) {
    return templatePrefix + name;
  }

  return name;
};
