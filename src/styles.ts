import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { watch } from 'chokidar';
import * as sass from 'sass';
import slash from 'slash';
import debounce from 'debounce';
import { glob } from 'glob';
import browserslist from 'browserslist';
import { browserslistToTargets, transform as lightningTransform, type Targets } from 'lightningcss';
import { RawSourceMap } from 'source-map-js';

import {
  createStyleCompileQueue,
  createScssImporterResult,
  getStyleCompileConcurrency,
  getStyleWatchOptions,
  getStylesOutputFileName,
  prepareCssFileContent,
  sortStylePaths,
  stripInjectedPreludeFromSourceMap,
} from './styles-core.js';
import { getPackageRoot } from './paths.js';

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
export const runStyleBuild = async (options: StyleBuildOptions): Promise<void> => {
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

  const reportStyleFailure = (file: string, kind: 'sass' | 'lightningcss-error' | 'lightningcss-warning', detail: unknown): void => {
    log('\n[styles:FAIL]', kind, '-', file);
    log(detail);

    if (!isWatch) {
      process.exitCode = 1;
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
      style: 'compressed',
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

  const postcssProcess = (result: sass.CompileResult, from: string, to: string): void => {
    const inputMap = stripInjectedPreludeFromSourceMap(result.sourceMap as RawSourceMap, undefined, { projectRoot });

    let output;
    const cssInput = result.css.charCodeAt(0) === 0xfeff ? result.css.slice(1) : result.css;

    try {
      output = lightningTransform({
        filename: slash(path.relative(projectRoot, from)),
        code: Buffer.from(cssInput),
        minify: true,
        sourceMap: true,
        inputSourceMap: JSON.stringify(inputMap),
        targets: lightningTargets,
        errorRecovery: true,
      });
    } catch (error) {
      reportStyleFailure(from, 'lightningcss-error', error);

      return;
    }

    if (output.warnings && output.warnings.length > 0) {
      output.warnings.forEach((warning) => {
        reportStyleFailure(from, 'lightningcss-warning', warning);
      });
    }

    const cssOutput = Buffer.from(output.code).toString('utf-8');
    const mapString = output.map ? Buffer.from(output.map).toString('utf-8') : undefined;

    // Detect Sass functions that survived into the compiled CSS.
    const SCSS_FUNCTION_LEAK_PATTERN = /\b(?:px2rem|px2em|rtl|str-replace|div)\(/g;
    const leaks = cssOutput.match(SCSS_FUNCTION_LEAK_PATTERN);

    if (leaks && leaks.length > 0) {
      reportStyleFailure(from, 'lightningcss-warning', `unevaluated SCSS function(s) leaked into output: ${[...new Set(leaks)].join(', ')}`);
    }

    fs.writeFileSync(path.join(outDir, to), cssOutput + (mapString ? `\n/*# sourceMappingURL=${to}.map */` : ''));

    if (mapString) {
      fs.writeFileSync(path.join(outDir, to + '.map'), mapString);
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

    // Queue the whole Sass + lightningcss job so one-shot builds do not start
    // every stylesheet at once. Bun's async Sass path can retain enough native
    // work at high fan-out to make clean `bun styles` runs flaky; using sync
    // Sass inside a bounded queue keeps memory pressure predictable while still
    // letting watch mode coalesce quick edit bursts through the existing
    // debounced entry points.
    void compileQueue.add(() => {
      try {
        const cssStrings = getCssSourceContent(srcFile, 'compile');

        if (srcFile.includes('style-base') || srcFile.includes('style-all')) {
          sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/atoms/**/*.scss')))).forEach((atomPath) => {
            if (!path.basename(atomPath).startsWith('_')) {
              cssStrings.push(
                sass.compileString(prepareCssFileContent({ srcFile: atomPath, projectRoot }).join(''), getStringOptions<'sync'>(atomPath)).css
              );
            }
          });

          sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/molecules/**/*.scss')))).forEach((molPath) => {
            if (!path.basename(molPath).startsWith('_')) {
              cssStrings.push(
                sass.compileString(prepareCssFileContent({ srcFile: molPath, projectRoot }).join(''), getStringOptions<'sync'>(molPath)).css
              );
            }
          });
        }

        const result = sass.compileString(cssStrings.join(''), getStringOptions<'sync'>(srcFile));

        postcssProcess(result, srcFile, outFile);
      } catch (error) {
        reportStyleFailure(srcFile, 'sass', error);
      }
    });
  };

  const styleOrganisms = debounce((isReady: boolean) => {
    const paths = sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/organisms/**/*.scss')), { nodir: true }));

    paths.forEach((p) => styleOrganism(p, isReady));
  }, DEBOUNCE_DELAY_MS);

  const styleTemplates = debounce((isReady: boolean) => {
    const paths = sortStylePaths(glob.sync(slash(path.resolve(projectRoot, 'src/templates/**/*.scss')), { nodir: true }));

    paths.forEach((p) => styleTemplate(p, isReady));
  }, DEBOUNCE_DELAY_MS);

  const styleBase = debounce(
    (isReady: boolean) => compile(path.resolve(projectRoot, 'src/assets/styles/style-base.scss'), { isReady }),
    DEBOUNCE_DELAY_MS
  );
  // Copy precompiled CSS + source map from dist/styles/ to the output directory
  const copyPrecompiledStyle = (cssFile: string, outName: string): void => {
    try {
      fs.copyFileSync(cssFile, path.join(outDir, outName));
      const mapFile = cssFile + '.map';

      if (fs.existsSync(mapFile)) {
        fs.copyFileSync(mapFile, path.join(outDir, outName + '.map'));
      }
    } catch (error) {
      reportStyleFailure(cssFile, 'sass', error);
    }
  };

  const stylePlState = debounce((isReady: boolean) => {
    const precompiled = path.join(alveoDistStyles, 'pl-states.css');

    if (usePrecompiled && fs.existsSync(precompiled)) {
      copyPrecompiledStyle(precompiled, 'pl-states.css');
    } else {
      compile(path.resolve(packageRoot, 'src/styles/pl-states.scss'), { isReady });
    }
  }, DEBOUNCE_DELAY_MS);

  const styleRoot = debounce((isReady: boolean) => {
    const precompiled = path.join(alveoDistStyles, 'root.css');

    if (usePrecompiled && fs.existsSync(precompiled)) {
      copyPrecompiledStyle(precompiled, 'root.css');
    } else {
      compile(path.resolve(packageRoot, 'src/styles/root.scss'), { isReady });
    }
  }, DEBOUNCE_DELAY_MS);
  const styleOrganism = (srcFile: string, isReady: boolean): void => compile(srcFile, { prefix: ORGANISM_PREFIX, isReady });
  const styleTemplate = (srcFile: string, isReady: boolean): void => compile(srcFile, { prefix: TEMPLATE_PREFIX, isReady });

  const sassCompile = (inputPath: string, isReady: boolean): void => {
    const p = slash(inputPath);
    const relPath = slash(path.relative(projectRoot, inputPath));

    if (relPath.startsWith(SRC_ABSTRACTS_PREFIX) || relPath.startsWith(SRC_FUNCTIONS_PREFIX) || relPath.startsWith(SRC_MIXINS_PREFIX)) {
      styleBase(isReady);
      styleOrganisms(isReady);
      styleTemplates(isReady);
      stylePlState(isReady);
    }

    if (relPath.startsWith(SRC_ATOMS_PREFIX) || relPath.startsWith(SRC_MOLECULES_PREFIX) || relPath.startsWith(SRC_BASE_PREFIX)) {
      styleBase(isReady);
    }

    if (relPath.startsWith(SRC_ORGANISMS_PREFIX)) {
      if (path.basename(p).startsWith('_')) {
        sortStylePaths(glob.sync(path.dirname(p) + '/*.scss', { nodir: true }))
          .filter((f) => !path.basename(f).startsWith('_'))
          .forEach((f) => styleOrganism(f, isReady));
      } else {
        styleOrganism(p, isReady);
      }
    }

    if (relPath.startsWith(SRC_TEMPLATES_PREFIX)) {
      if (path.basename(p).startsWith('_')) {
        sortStylePaths(glob.sync(path.dirname(p) + '/*.scss', { nodir: true }))
          .filter((f) => !path.basename(f).startsWith('_'))
          .forEach((f) => styleTemplate(f, isReady));
      } else {
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

  if (isWatch) {
    const watchPaths = [slash(path.resolve(projectRoot, 'src'))];

    if (hasScssSource) {
      watchPaths.push(slash(path.resolve(packageRoot, 'src/styles')));
    }

    // Seed precompiled framework CSS so it's available before any file events
    if (usePrecompiled) {
      stylePlState(false);
      styleRoot(false);
    }

    const watcher = watch(watchPaths, getStyleWatchOptions());
    let ready = false;

    watcher
      .on('ready', () => {
        log('SCSS ready!');
        ready = true;
      })
      .on('add', (f) => sassCompile(f, ready))
      .on('change', (f) => sassCompile(f, ready))
      .on('unlink', (f) => {
        log(`File ${f} has been removed`);
        cleanUpOutput(f);
      });
  } else {
    styleBase(true);
    stylePlState(true);
    styleRoot(true);

    const consumerGlob = slash(path.resolve(projectRoot, 'src/{organisms,templates}/**/*.scss'));
    const globs = [consumerGlob];

    if (!usePrecompiled) {
      globs.push(slash(path.resolve(packageRoot, 'src/styles/**/*.scss')));
    }

    sortStylePaths(glob.sync(globs))
      .filter((f) => !path.basename(f).startsWith('_'))
      .forEach((f) => sassCompile(f, true));

    // Drain every queued compile before exiting so `reportStyleFailure()` calls
    // reliably set `process.exitCode` BEFORE Bun terminates. Without this drain
    // the script returns synchronously, failures fire late, and the exit code is
    // racy (0 vs. 1 across consecutive runs).
    //
    // The compile entry points are debounced, so we wait one debounce tick
    // first to let queued debounced calls invoke `compile()` and enter the
    // bounded queue.
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_DELAY_MS + 50));
    await compileQueue.drain();
  }
};
