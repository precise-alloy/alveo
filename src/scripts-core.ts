import fs from 'node:fs';
import path from 'node:path';

import chokidar from 'chokidar';
import debounce from 'debounce';
import { globSync } from 'glob';
import { build, type BuildOptions, type RolldownPluginOption } from 'rolldown';
import slash from 'slash';

import { createAliases } from './alias.ts';
import { getScriptEntryName, isScriptEntry, SCRIPT_ENTRY_IGNORE_PATTERNS } from './filename.ts';
import injectFunctions from './hooks/inject-functions.ts';
import { resolveEntryIsolatedId } from './hooks/options.ts';
import transform from './hooks/transform.ts';
import { createPaths, getPackageRoot } from './paths.ts';
import { normalizeTextLikeContent } from './text-normalization.ts';

export interface ScriptCoreDependencies {
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
  rmSync: typeof fs.rmSync;
  build: typeof build;
  globSync: (pattern: string, options: { ignore: string[] }) => string[];
  createWatcher: typeof chokidar.watch;
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface ScriptError {
  inputPath: string;
  error: unknown;
}
export interface ScriptBuildResult {
  ok: boolean;
  errors: ScriptError[];
  inputs: string[];
}

export const defaultScriptCoreDependencies: ScriptCoreDependencies = {
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  rmSync: fs.rmSync,
  build,
  globSync,
  createWatcher: chokidar.watch,
  log: console.error.bind(console),
};

export function getScriptOutputPath(inputPath: string, projectRoot: string): string {
  const name = getScriptEntryName(inputPath);

  if (!isScriptEntry(inputPath) || !name) throw new Error(`Script entry must be named <name>.entry.{js,jsx,ts,tsx}: ${inputPath}`);

  return path.resolve(projectRoot, 'public/assets/js', name + '.js');
}

export const getScriptBuildOptions = (inputPath: string, projectRoot: string): BuildOptions => {
  const paths = createPaths(projectRoot, 'production');
  const env = paths.alveoEnv;
  const baseUrl = env.VITE_BASE_URL ?? '/';
  const context = {
    projectRoot: paths.root,
    packageRoot: getPackageRoot(),
    srcRoot: paths.srcRoot,
    outDir: paths.outDir,
    env,
    mode: paths.mode,
  };

  return {
    cwd: projectRoot,
    input: inputPath,
    platform: 'browser',
    resolve: {
      alias: Object.fromEntries(createAliases(projectRoot).map(({ find, replacement }) => [find, replacement])),
    },
    transform: {
      jsx: 'react-jsx',
      define: {
        'import.meta.env.BASE_URL': JSON.stringify(baseUrl),
        ...Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
        'import.meta.env': JSON.stringify({ ...env, BASE_URL: baseUrl }),
      },
    },
    plugins: [
      injectFunctions() as RolldownPluginOption,
      {
        name: 'alveo-forbid-cross-entry-import',
        resolveId(source, importer, resolveOptions) {
          return resolveEntryIsolatedId(this.resolve.bind(this), source, importer, resolveOptions, false);
        },
      },
      transform(context) as RolldownPluginOption,
    ],
    write: false,
    output: {
      file: getScriptOutputPath(inputPath, projectRoot),
      format: 'esm',
      minify: true,
      sourcemap: path.basename(inputPath).includes('critical') ? false : true,
      codeSplitting: false,
    },
  };
};

const resolveWatchedModulePath = (projectRoot: string, realProjectRoot: string, cleanId: string): string => {
  const resolvedId = fs.realpathSync(cleanId);
  const relativeToRoot = path.relative(realProjectRoot, resolvedId);

  if (relativeToRoot && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
    return path.resolve(projectRoot, relativeToRoot);
  }

  return resolvedId;
};

export async function compileScript(
  inputPath: string,
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ScriptBuildResult> {
  dependencies.log('compile:', slash(inputPath));
  try {
    const outputFilePath = getScriptOutputPath(inputPath, projectRoot);
    const outputDir = path.dirname(outputFilePath);
    const result = await dependencies.build(getScriptBuildOptions(inputPath, projectRoot));

    if (!result || !('output' in result) || !Array.isArray(result.output) || result.output.length === 0) {
      throw new Error(`Script compiler returned incomplete output for ${inputPath}`);
    }

    // Rolldown resolves symlinks in `moduleIds` (e.g. `/var` -> `/private/var` on macOS).
    // Re-anchor module paths inside the real project root onto `projectRoot`, while
    // keeping canonical real paths for dependencies outside a symlinked project root.
    const realProjectRoot = fs.realpathSync(projectRoot);
    const inputs: string[] = [];

    for (const item of result.output) {
      const filePath = path.resolve(outputDir, item.fileName);
      const raw = item.type === 'chunk' ? Buffer.from(item.code) : Buffer.from(item.source);

      dependencies.mkdirSync(path.dirname(filePath), { recursive: true });
      dependencies.writeFileSync(filePath, normalizeTextLikeContent(filePath, raw));
      if (item.type !== 'chunk') continue;
      for (const id of item.moduleIds) {
        if (!id.startsWith('\0')) {
          inputs.push(resolveWatchedModulePath(projectRoot, realProjectRoot, id.split('?', 1)[0]!));
        }
      }
    }

    return { ok: true, errors: [], inputs };
  } catch (error) {
    dependencies.log(error);

    return { ok: false, errors: [{ inputPath, error }], inputs: [] };
  }
}

export async function compileDiscoveredScripts(
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ScriptBuildResult> {
  try {
    const inputs = dependencies
      .globSync(slash(path.resolve(projectRoot, 'src/assets/scripts/**/*.entry.{js,jsx,ts,tsx}')), {
        ignore: [...SCRIPT_ENTRY_IGNORE_PATTERNS],
      })
      .sort();
    const outputs = new Set<string>();

    for (const input of inputs) {
      const output = getScriptOutputPath(input, projectRoot);

      if (outputs.has(output)) throw new Error(`Duplicate script output: ${output}`);
      outputs.add(output);
    }
    const results = await Promise.all(inputs.map((input) => compileScript(input, projectRoot, dependencies)));
    const errors = results.flatMap((result) => result.errors);

    return { ok: errors.length === 0, errors, inputs: [...new Set(results.flatMap((result) => result.inputs))] };
  } catch (error) {
    dependencies.log(error);

    return { ok: false, errors: [{ inputPath: projectRoot, error }], inputs: [] };
  }
}

export async function watchScripts(
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ReturnType<typeof chokidar.watch>> {
  // Chokidar 5 does not expand globs. Watch the source directory for discovery
  // and add Rolldown's actual dependency graph, including imports outside src.
  const watcher = dependencies.createWatcher(path.join(projectRoot, 'src'), { ignoreInitial: true });
  let pending = Promise.resolve();
  const rebuild = () => {
    pending = pending.then(async () => {
      const result = await compileDiscoveredScripts(projectRoot, dependencies);

      watcher.add(result.inputs);
    });

    return pending;
  };
  const schedule = debounce(() => {
    void rebuild();
  }, 100);

  watcher.on('all', (event, file) => {
    if (event === 'unlink' && isScriptEntry(file)) {
      const output = getScriptOutputPath(file, projectRoot);

      for (const target of [output, output + '.map', output.replace(/\.js$/, '.css'), output.replace(/\.js$/, '.css.map')]) {
        dependencies.rmSync(target, { force: true });
      }
    }
    schedule();
  });
  watcher.on('error', (error) => dependencies.log(error));

  const close = watcher.close.bind(watcher);

  watcher.close = async () => {
    schedule.clear();
    await pending;
    await close();
  };
  await rebuild();

  return watcher;
}

export async function runScriptBuild(
  projectRoot: string,
  argv = process.argv,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ReturnType<typeof chokidar.watch> | ScriptBuildResult> {
  return argv.includes('--watch') ? watchScripts(projectRoot, dependencies) : compileDiscoveredScripts(projectRoot, dependencies);
}
