import fs from 'node:fs';
import path from 'node:path';

import chokidar from 'chokidar';
import debounce from 'debounce';
import { globSync } from 'glob';
import { build, type BuildOptions } from 'esbuild';
import slash from 'slash';

import { getScriptEntryName, SCRIPT_ENTRY_IGNORE_PATTERNS } from './filename.ts';
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

const isEntry = (file: string) => /\.entry\.[jt]sx?$/i.test(file);

export function getScriptOutputPath(inputPath: string, projectRoot: string): string {
  const name = getScriptEntryName(inputPath);

  if (!isEntry(inputPath) || !name) throw new Error(`Script entry must be named <name>.entry.{js,jsx,ts,tsx}: ${inputPath}`);

  return path.resolve(projectRoot, 'public/assets/js', name + '.js');
}

export const getScriptBuildOptions = (inputPath: string, projectRoot: string): BuildOptions => ({
  absWorkingDir: projectRoot,
  entryPoints: [inputPath],
  outfile: getScriptOutputPath(inputPath, projectRoot),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  sourcemap: path.basename(inputPath).includes('critical') ? false : 'linked',
  sourcesContent: true,
  metafile: true,
  write: false,
});

export async function compileScript(
  inputPath: string,
  projectRoot: string,
  dependencies: ScriptCoreDependencies = defaultScriptCoreDependencies
): Promise<ScriptBuildResult> {
  dependencies.log('compile:', slash(inputPath));
  try {
    const result = await dependencies.build(getScriptBuildOptions(inputPath, projectRoot));

    if (!result.outputFiles || !result.metafile) throw new Error(`Script compiler returned incomplete output for ${inputPath}`);
    for (const file of result.outputFiles) {
      dependencies.mkdirSync(path.dirname(file.path), { recursive: true });
      dependencies.writeFileSync(file.path, normalizeTextLikeContent(file.path, Buffer.from(file.contents)));
    }

    return { ok: true, errors: [], inputs: Object.keys(result.metafile.inputs).map((file) => path.resolve(projectRoot, file)) };
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
  // and add esbuild's actual dependency graph, including imports outside src.
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
    if (event === 'unlink' && isEntry(file)) {
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
