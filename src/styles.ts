import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { watch, type FSWatcher } from 'chokidar';
import * as sass from 'sass';
import slash from 'slash';
import debounce from 'debounce';
import { glob } from 'glob';
import browserslist from 'browserslist';
import { browserslistToTargets, type Targets } from 'lightningcss';
import { RawSourceMap } from 'source-map-js';

import {
  createStyleCompileQueue,
  createScssImporterResult,
  createStyleBundleSource,
  getStyleCompileConcurrency,
  getStyleWatchOptions,
  getStylesOutputFileName,
  prepareCssFileContent,
  sortStylePaths,
  stripInjectedPreludeFromSourceMap,
  transformStyleCss,
} from './styles-core.ts';
import { getPackageRoot } from './paths.ts';

const DEBOUNCE_DELAY_MS = 200;
const ORGANISM_PREFIX = 'b-';
const TEMPLATE_PREFIX = 'p-';

// Path-segment markers (slash-bounded) used to decide which prelude pieces
// to inject when an importer load lands on a particular file.
const matchesPathSegment = (slashed: string, segment: string): boolean => slashed.includes(`/${segment}/`) || slashed.startsWith(`${segment}/`);
const matchesPathSuffix = (slashed: string, suffix: string): boolean => slashed.endsWith(`/${suffix}`) || slashed === suffix;

export interface StyleBuildOptions {
  projectRoot: string;
  isWatch?: boolean;
}

/**
 * Runs the SCSS compilation pipeline for a consumer project.
 *
 * @param options.projectRoot - Absolute path to the consumer's project root
 * @param options.isWatch - Whether to watch for changes (defaults to false)
 */
export const runStyleBuild = async (options: StyleBuildOptions): Promise<void | FSWatcher> => {
  const { projectRoot, isWatch = false } = options;
  const packageRoot = getPackageRoot();

  const outDir = slash(path.resolve(projectRoot, 'public/assets/css'));

  // Relative path prefixes resolved from the consumer's project
  const SRC_ABSTRACTS_PREFIX = 'src/assets/styles/00-abstracts/';
  const SRC_FUNCTIONS_PREFIX = 'src/assets/styles/01-functions/';
  const SRC_MIXINS_PREFIX = 'src/assets/styles/01-mixins/';
  const SRC_ATOMS_PREFIX = 'src/atoms';
  const SRC_MOLECULES_PREFIX = 'src/molecules';
  const SRC_BASE_PREFIX = 'src/assets/styles/02-base';
  const SRC_ORGANISMS_PREFIX = 'src/organisms';
  const SRC_TEMPLATES_PREFIX = 'src/templates';

  // Framework styles from the alveo package itself
  const ALVEO_PL_STATES_PREFIX = slash(path.resolve(packageRoot, 'src/styles/pl-states'));
  const ALVEO_STYLES_PREFIX = slash(path.resolve(packageRoot, 'src/styles'));
  const alveoDistStyles = path.resolve(packageRoot, 'dist/styles');
  // Prefer SCSS source for local dev; use precompiled CSS only for published installs
  const hasScssSource = fs.existsSync(path.resolve(packageRoot, 'src/styles'));
  const usePrecompiled = !hasScssSource && fs.existsSync(alveoDistStyles);

  const ABSTRACTS_DIR = 'src/assets/styles/00-abstracts';
  const MIXINS_DIR = 'src/assets/styles/01-mixins';
  const FUNCTIONS_DIR = 'src/assets/styles/01-functions';
  const BASE_DIR = 'src/assets/styles/02-base';
  const ALVEO_DIR = slash(path.resolve(packageRoot, 'src'));
  // Barrel files that just `@forward` their siblings — injecting a prelude that
  // `@use`s the same barrel would recurse forever.
  const MIXINS_BARREL = slash(path.resolve(projectRoot, `${MIXINS_DIR}/_mixins.scss`));
  const FUNCTIONS_BARREL = slash(path.resolve(projectRoot, `${FUNCTIONS_DIR}/_functions.scss`));
  const BASE_BARREL = slash(path.resolve(projectRoot, `${BASE_DIR}/_base.scss`));

  if (!isWatch && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { force: true, recursive: true });
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const log = console.log.bind(console);

  const compileQueue = createStyleCompileQueue(getStyleCompileConcurrency());
  const failures: unknown[] = [];
  const schedule = (compile: (isReady: boolean) => void) => (isWatch ? debounce(compile, DEBOUNCE_DELAY_MS) : compile);

  const reportStyleFailure = (file: string, kind: 'sass' | 'lightningcss-error' | 'lightningcss-warning', detail: unknown): void => {
    console.error('\n[styles:FAIL]', kind, '-', file, detail);

    if (!isWatch) {
      failures.push(detail);
    }
  };

  // Resolve browser targets once at startup.
  const lightningTargets: Targets = browserslistToTargets(browserslist(undefined, { path: projectRoot }));

  const isConsumerPath = (slashedPath: string): boolean => {
    return !slashedPath.startsWith(ALVEO_DIR + '/') && !slashedPath.includes('/node_modules/');
  };

  const getCssSourceContent = (srcFile: string, mode: 'importer' | 'compile'): string[] => {
    const slashed = slash(srcFile);
    const relPath = slash(path.relative(projectRoot, srcFile));

    if (mode === 'importer') {
      // Abstract leaves and the abstracts barrel don't depend on anything.
      // alveo stylesheets manage their own `@use` graph.
      if (matchesPathSegment(relPath, ABSTRACTS_DIR) || !isConsumerPath(slashed)) {
        return [fs.readFileSync(srcFile, 'utf-8')];
      }

      // Mixins barrel only `@forward`s siblings
      if (slashed === MIXINS_BARREL || matchesPathSuffix(relPath, `${MIXINS_DIR}/_mixins.scss`)) {
        return [fs.readFileSync(srcFile, 'utf-8')];
      }

      if (matchesPathSegment(relPath, MIXINS_DIR)) {
        return prepareCssFileContent({ srcFile, projectRoot, includeMixins: false });
      }

      // Functions barrel
      if (slashed === FUNCTIONS_BARREL || matchesPathSuffix(relPath, `${FUNCTIONS_DIR}/_functions.scss`)) {
        return [fs.readFileSync(srcFile, 'utf-8')];
      }

      if (matchesPathSegment(relPath, FUNCTIONS_DIR)) {
        return prepareCssFileContent({ srcFile, projectRoot, includeMixins: false, includeFunctions: false });
      }

      // Base barrel
      if (slashed === BASE_BARREL || matchesPathSuffix(relPath, `${BASE_DIR}/_base.scss`)) {
        return [fs.readFileSync(srcFile, 'utf-8')];
      }

      return prepareCssFileContent({ srcFile, projectRoot });
    }

    // Compile mode: alveo entry stylesheets manage their own imports.
    if (!isConsumerPath(slashed)) {
      return [fs.readFileSync(srcFile, 'utf-8')];
    }

    return prepareCssFileContent({ srcFile, projectRoot });
  };

  const getStringOptions = <Sync extends 'sync' | 'async'>(srcFile: string): sass.StringOptions<Sync> => {
    const options: sass.StringOptions<Sync> = {
      sourceMap: true,
      sourceMapIncludeSources: true,
      syntax: 'scss',
      // Sass's compressed output can collapse cross-module mappings onto the
      // first source. Keep its intermediate map detailed and minify only once,
      // in LightningCSS after source identities and prelude offsets are fixed.
      style: 'expanded',
      url: pathToFileURL(path.resolve(srcFile)),
      importer: {
        canonicalize(url, context) {
          try {
            return new URL(url);
          } catch {
            if (context?.containingUrl) {
              try {
                return new URL(url, context.containingUrl);
              } catch {
                return null;
              }
            }

            return null;
          }
        },
        load(canonicalUrl: URL) {
          let filePath = fileURLToPath(canonicalUrl);

          if (!filePath.endsWith('.scss')) {
            const parentDir = path.dirname(filePath);
            const fileName = path.basename(filePath);

            filePath = path.join(parentDir, fileName + '.scss');

            if (!fs.existsSync(filePath)) {
              filePath = path.join(parentDir, '_' + fileName + '.scss');
            }
          }

          if (!fs.existsSync(filePath)) return null;

          return createScssImporterResult(filePath, getCssSourceContent(filePath, 'importer').join(''));
        },
      },
    };

    return options;
  };

  const postcssProcess = (result: Pick<sass.CompileResult, 'css' | 'sourceMap'>, from: string, to: string): void => {
    if (!result.sourceMap) throw new Error(`Sass did not produce a source map for ${from}`);
    const inputMap = stripInjectedPreludeFromSourceMap(result.sourceMap as RawSourceMap, undefined, { projectRoot });

    try {
      const output = transformStyleCss(result.css, inputMap, path.relative(projectRoot, from), lightningTargets);

      fs.writeFileSync(path.join(outDir, to), output.css + `\n/*# sourceMappingURL=${to}.map */`);
      fs.writeFileSync(path.join(outDir, to + '.map'), output.map);
    } catch (error) {
      reportStyleFailure(from, 'lightningcss-error', error);
    }
  };

  const compile = (srcFile: string, compileOptions: { prefix?: string; isReady: boolean }): void => {
    if (compileOptions.isReady) {
      log('compile:', slash(srcFile));
    }

    if (path.basename(srcFile).startsWith('_')) {
      return;
    }

    const name =
      path.basename(srcFile) === 'index.scss' ? path.basename(path.dirname(srcFile)) + '.css' : path.basename(srcFile).replace(/\.scss$/, '.css');

    const outFile = (compileOptions.prefix ?? '') + name;

    // This queue bounds pending work and provides a drain contract; synchronous
    // Sass does not gain CPU parallelism from its concurrency setting.
    void compileQueue.add(() => {
      try {
        let contents: string;
        const stringOptions = getStringOptions<'sync'>(srcFile);

        if (['style-base.scss', 'style-all.scss'].includes(path.basename(srcFile))) {
          const bundle = createStyleBundleSource(srcFile, glob.sync(slash(path.resolve(projectRoot, 'src/{atoms,molecules}/**/*.scss'))));

          contents = bundle.contents;
          stringOptions.url = bundle.url;
        } else {
          contents = getCssSourceContent(srcFile, 'compile').join('');
        }

        const result = sass.compileString(contents, stringOptions);

        postcssProcess(result, srcFile, outFile);
      } catch (error) {
        reportStyleFailure(srcFile, 'sass', error);
      }
    });
  };

  const styleOrganisms = schedule((isReady: boolean) => {
    const paths = sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/organisms/**/*.scss')), { nodir: true }));

    paths.forEach((p) => styleOrganism(p, isReady));
  });

  const styleTemplates = schedule((isReady: boolean) => {
    const paths = sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/templates/**/*.scss')), { nodir: true }));

    paths.forEach((p) => styleTemplate(p, isReady));
  });

  const styleBase = schedule((isReady: boolean) => compile(path.resolve(projectRoot, 'src/assets/styles/style-base.scss'), { isReady }));
  // Published CSS still needs the consumer's browser targets. Embedded map
  // sources let the same LightningCSS path work without shipping raw SCSS.
  const copyPrecompiledStyle = (cssFile: string, outName: string): void => {
    try {
      postcssProcess(
        {
          css: fs.readFileSync(cssFile, 'utf8').replace(/\n?\/\*# sourceMappingURL=.*?\*\/\s*$/, ''),
          sourceMap: JSON.parse(fs.readFileSync(cssFile + '.map', 'utf8')),
        },
        cssFile,
        outName
      );
    } catch (error) {
      reportStyleFailure(cssFile, 'sass', error);
    }
  };

  const buildPlState = (isReady: boolean) => {
    const precompiled = path.join(alveoDistStyles, 'pl-states.css');

    if (usePrecompiled && fs.existsSync(precompiled)) {
      copyPrecompiledStyle(precompiled, 'pl-states.css');
    } else {
      compile(path.resolve(packageRoot, 'src/styles/pl-states.scss'), { isReady });
    }
  };
  const stylePlState = schedule(buildPlState);

  const buildRoot = (isReady: boolean) => {
    const precompiled = path.join(alveoDistStyles, 'root.css');

    if (usePrecompiled && fs.existsSync(precompiled)) {
      copyPrecompiledStyle(precompiled, 'root.css');
    } else {
      compile(path.resolve(packageRoot, 'src/styles/root.scss'), { isReady });
    }
  };
  const styleRoot = schedule(buildRoot);
  const styleOrganism = (srcFile: string, isReady: boolean): void => compile(srcFile, { prefix: ORGANISM_PREFIX, isReady });
  const styleTemplate = (srcFile: string, isReady: boolean): void => compile(srcFile, { prefix: TEMPLATE_PREFIX, isReady });

  const sassCompile = (inputPath: string, isReady: boolean): void => {
    const p = slash(inputPath);
    const relPath = slash(path.relative(projectRoot, inputPath));

    if ([SRC_ABSTRACTS_PREFIX, SRC_FUNCTIONS_PREFIX, SRC_MIXINS_PREFIX].some((prefix) => relPath.startsWith(prefix))) {
      styleBase(isReady);
      styleOrganisms(isReady);
      styleTemplates(isReady);
      stylePlState(isReady);
    }

    if (
      relPath === 'src/assets/styles/style-base.scss' ||
      relPath.startsWith(SRC_ATOMS_PREFIX) ||
      relPath.startsWith(SRC_MOLECULES_PREFIX) ||
      relPath.startsWith(SRC_BASE_PREFIX)
    ) {
      styleBase(isReady);
    }

    if (relPath.startsWith(SRC_ORGANISMS_PREFIX)) {
      if (path.basename(p).startsWith('_')) {
        sortStylePaths(glob.sync(path.dirname(p) + '/*.scss', { nodir: true }))
          .filter((f) => !path.basename(f).startsWith('_'))
          .forEach((f) => styleOrganism(f, isReady));
      } else if (fs.existsSync(p)) {
        styleOrganism(p, isReady);
      }
    }

    if (relPath.startsWith(SRC_TEMPLATES_PREFIX)) {
      if (path.basename(p).startsWith('_')) {
        sortStylePaths(glob.sync(path.dirname(p) + '/*.scss', { nodir: true }))
          .filter((f) => !path.basename(f).startsWith('_'))
          .forEach((f) => styleTemplate(f, isReady));
      } else if (fs.existsSync(p)) {
        styleTemplate(p, isReady);
      }
    }

    // Handle framework styles from package
    if (p.startsWith(ALVEO_PL_STATES_PREFIX)) {
      stylePlState(isReady);
    } else if (p.startsWith(ALVEO_STYLES_PREFIX)) {
      styleRoot(isReady);
    }
  };

  const getOutFileName = (srcFile: string): string | undefined => {
    return getStylesOutputFileName(srcFile, { organismPrefix: ORGANISM_PREFIX, templatePrefix: TEMPLATE_PREFIX });
  };

  const cleanUpOutput = (srcFile: string): void => {
    const outFile = getOutFileName(srcFile);

    if (!outFile) return;

    const cssPath = path.join(outDir, outFile);
    const mapPath = cssPath + '.map';

    if (fs.existsSync(cssPath)) fs.unlinkSync(cssPath);
    if (fs.existsSync(mapPath)) fs.unlinkSync(mapPath);
  };

  const buildAll = () => {
    compile(path.resolve(projectRoot, 'src/assets/styles/style-base.scss'), { isReady: true });
    buildPlState(true);
    buildRoot(true);
    sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/{organisms,templates}/**/*.scss'))))
      .filter((file) => !path.basename(file).startsWith('_'))
      .forEach((file) => sassCompile(file, true));
  };

  if (isWatch) {
    const watchPaths = [slash(path.resolve(projectRoot, 'src'))];

    if (hasScssSource) {
      watchPaths.push(slash(path.resolve(packageRoot, 'src/styles')));
    }

    const watcher = watch(watchPaths, getStyleWatchOptions());
    let ready = false;

    watcher
      .on('ready', async () => {
        buildAll();
        await compileQueue.drain();
        log('SCSS ready!');
        ready = true;
      })
      .on('add', (f) => sassCompile(f, ready))
      .on('change', (f) => sassCompile(f, ready))
      .on('unlink', (f) => {
        log(`File ${f} has been removed`);
        cleanUpOutput(f);
        sassCompile(f, ready);
      });

    return watcher;
  } else {
    buildAll();
    await compileQueue.drain();
    if (failures.length > 0) throw new AggregateError(failures, 'Styles build failed; subsequent build stages were not run.');
  }
};
