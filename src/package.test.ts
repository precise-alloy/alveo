// @vitest-environment node

import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Script } from 'node:vm';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);

describe('package distribution', () => {
  it('keeps compiler and mocking dependencies installed and shares React peers with consumers', async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

    for (const dependency of ['esbuild', 'msw', 'vite', 'sass']) {
      expect(manifest.dependencies).toHaveProperty(dependency);
      expect(manifest.devDependencies).not.toHaveProperty(dependency);
    }
    for (const dependency of ['react', 'react-dom', 'react-router-dom']) {
      expect(manifest.dependencies).not.toHaveProperty(dependency);
      expect(manifest.peerDependencies[dependency]).toBe(manifest.devDependencies[dependency]);
    }
    expect(manifest.peerDependenciesMeta.typescript.optional).toBe(true);
    expect(manifest.devDependencies).toHaveProperty('prettier');
    expect(manifest.engines.node).toBe('>=22.12.0');
  });

  it('keeps the static starter build tools separate from application dependencies', async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const template = JSON.parse(await readFile(join(PACKAGE_ROOT, 'template/package.json'), 'utf8'));

    expect(template.dependencies).not.toHaveProperty('alveo');
    expect(template.devDependencies.alveo).toBeDefined();
    expect(template.devDependencies.alveo).not.toBe('latest');
    expect(template.dependencies).toHaveProperty('css');
    expect(template.devDependencies).toHaveProperty('@vitejs/plugin-react');
    for (const dependency of ['react', 'react-dom', 'react-router-dom']) {
      expect(template.dependencies[dependency]).toBe(manifest.peerDependencies[dependency]);
    }
    for (const dependency of ['@next/eslint-plugin-next', 'eslint-config-next', 'eslint-plugin-node']) {
      expect(template.devDependencies).not.toHaveProperty(dependency);
    }
  });

  it('loads the starter lint config without Next.js plugins or rules', async () => {
    const eslint = new ESLint({
      cwd: join(PACKAGE_ROOT, 'template'),
      overrideConfigFile: join(PACKAGE_ROOT, 'template/eslint.config.mjs'),
    });
    const config = await eslint.calculateConfigForFile('src/client-components.tsx');

    expect(config.plugins).not.toHaveProperty('@next/next');
    expect(config.rules).not.toHaveProperty('@next/next/no-img-element');
    expect(config.rules['react-refresh/only-export-components']).toEqual([2]);
  });

  it('installs a clean tarball with working production dependencies, CLI, and consumer types', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'alveo-package-'));
    const buildRoot = join(temporaryRoot, 'build');
    const consumerRoot = join(temporaryRoot, 'consumer');
    const consumerModules = join(consumerRoot, 'node_modules');
    const installedRoot = join(consumerModules, 'alveo');
    const archivePath = join(temporaryRoot, 'alveo.tgz');
    const installCache = join(temporaryRoot, 'bun-cache');
    const dependencies = join(PACKAGE_ROOT, 'node_modules');

    try {
      // A developer's existing dist can hide a check-only build, as in 0.3.0.
      // Copy build inputs only and reuse installed build dependencies without
      // letting stale output satisfy the exports in the consumer installation.
      await mkdir(buildRoot);
      for (const entry of ['package.json', 'tsconfig.json', '.npmignore', 'src', 'bin', 'template', 'README.md', 'LICENSE']) {
        await cp(join(PACKAGE_ROOT, entry), join(buildRoot, entry), { recursive: true });
      }
      await symlink(dependencies, join(buildRoot, 'node_modules'), 'junction');
      await execFileAsync('bun', ['run', 'build'], { cwd: buildRoot });

      // Exercise the package allowlist, not just the build directory. The Git
      // prepare hook must not run inside this disposable, non-Git checkout.
      await execFileAsync('bun', ['pm', 'pack', '--ignore-scripts', '--quiet', '--filename', archivePath], { cwd: buildRoot });
      const packageManifest = JSON.parse(await readFile(join(buildRoot, 'package.json'), 'utf8'));
      const consumerManifest = {
        name: 'alveo-package-consumer',
        private: true,
        type: 'module',
        dependencies: {
          alveo: pathToFileURL(archivePath).href,
          react: packageManifest.peerDependencies.react,
          'react-dom': packageManifest.peerDependencies['react-dom'],
          'react-router-dom': packageManifest.peerDependencies['react-router-dom'],
        },
      };

      await mkdir(consumerRoot);
      await writeFile(join(consumerRoot, 'package.json'), JSON.stringify(consumerManifest));

      // An isolated install prevents hoisted development packages from masking
      // missing runtime dependencies. A frozen-lockfile install caches archives,
      // but need not cache the registry manifests required for fresh resolution.
      // Start with a separate empty cache to exercise cold CI installs, fetching
      // missing metadata instead of depending on a developer's warmed cache.
      await execFileAsync(
        'bun',
        ['install', '--prefer-offline', '--production', '--ignore-scripts', '--linker', 'isolated', '--cache-dir', installCache],
        { cwd: consumerRoot, timeout: 60_000 }
      );

      const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
      const entryPoints = [...Object.values(manifest.exports['.']), manifest.bin.alveo, 'dist/cli.js'] as string[];

      for (const entryPoint of entryPoints) {
        await expect(access(join(installedRoot, entryPoint))).resolves.toBeUndefined();
      }

      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          [
            "import assert from 'node:assert/strict';",
            "import { createRequire } from 'node:module';",
            "import { createPaths } from 'alveo';",
            'const consumerRequire = createRequire(import.meta.url);',
            "const packageRequire = createRequire(consumerRequire.resolve('alveo'));",
            "assert.equal(typeof createPaths, 'function');",
            "for (const dependency of ['esbuild', 'msw']) assert.ok(packageRequire.resolve(dependency));",
            "for (const dependency of ['react', 'react-dom', 'react-router-dom']) {",
            '  assert.equal(packageRequire.resolve(dependency), consumerRequire.resolve(dependency));',
            '}',
            "for (const dependency of ['typescript', 'vitest', 'eslint']) {",
            "  assert.throws(() => packageRequire.resolve(dependency), { code: 'MODULE_NOT_FOUND' });",
            '}',
          ].join('\n'),
        ],
        { cwd: consumerRoot }
      );

      const scriptDirectory = join(consumerRoot, 'src/assets/scripts');

      await mkdir(scriptDirectory, { recursive: true });
      await writeFile(join(scriptDirectory, 'probe.ts'), 'globalThis.answer = (value: number) => value + 1;');
      await execFileAsync(process.execPath, [join(installedRoot, 'bin/cli.js'), 'scripts', '--root', consumerRoot], { cwd: consumerRoot });
      const scriptContext: Record<string, (value: number) => number> = {};

      new Script(await readFile(join(consumerRoot, 'public/assets/js/probe.js'), 'utf8')).runInNewContext(scriptContext);
      expect(scriptContext['answer']!(41)).toBe(42);

      // Intercept only the build subprocesses in a separate Node process. This
      // verifies both CLI invocations against the installed dependency tree
      // without requiring an unrelated full application fixture in this test.
      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          [
            "import assert from 'node:assert/strict';",
            "import childProcess from 'node:child_process';",
            "import { createRequire, syncBuiltinESMExports } from 'node:module';",
            "import path from 'node:path';",
            "import { pathToFileURL } from 'node:url';",
            'const consumerRequire = createRequire(import.meta.url);',
            "const packageRequire = createRequire(consumerRequire.resolve('alveo'));",
            "const cliPath = path.join(path.dirname(consumerRequire.resolve('alveo')), 'cli.js');",
            "const vitePath = path.resolve(path.dirname(packageRequire.resolve('vite/package.json')), packageRequire('vite/package.json').bin.vite);",
            'const calls = [];',
            'childProcess.execFileSync = (command, args, options) => { calls.push({ command, args, options }); return Buffer.alloc(0); };',
            'syncBuiltinESMExports();',
            "process.argv = [process.execPath, 'build', '--root', process.cwd()];",
            'await import(pathToFileURL(cliPath).href);',
            'assert.equal(calls.length, 2);',
            'for (const call of calls) {',
            '  assert.equal(call.command, process.execPath);',
            '  assert.equal(call.args[0], vitePath);',
            '  assert.equal(call.options.cwd, process.cwd());',
            '  assert.equal(call.options.shell, undefined);',
            '}',
            "assert.deepEqual(calls[0].args.slice(1), ['build', '--outDir', path.join('dist', 'static'), '--mode', 'production']);",
            "assert.deepEqual(calls[1].args.slice(1), ['build', '--outDir', path.join('dist', 'server'), '--mode', 'production', '--ssr', path.join(path.dirname(cliPath), 'entry-server.js')]);",
          ].join('\n'),
        ],
        { cwd: consumerRoot }
      );

      // Only TypeScript consumers need the compiler and ambient typings. Add
      // them after proving the production package works without dev tools;
      // never link the maintainer's node_modules into the installed package.
      await writeFile(
        join(consumerRoot, 'package.json'),
        JSON.stringify({
          ...consumerManifest,
          devDependencies: {
            typescript: packageManifest.devDependencies.typescript,
            '@types/node': packageManifest.devDependencies['@types/node'],
            '@types/react': packageManifest.devDependencies['@types/react'],
          },
        })
      );
      await execFileAsync('bun', ['install', '--prefer-offline', '--ignore-scripts', '--linker', 'isolated', '--cache-dir', installCache], {
        cwd: consumerRoot,
        timeout: 60_000,
      });
      const consumerEntry = join(consumerRoot, 'client-components.tsx');

      await writeFile(consumerEntry, "import type { ClientComponents } from 'alveo';\nexport const clientComponents: ClientComponents = {};\n");
      const program = ts.createProgram([consumerEntry], {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

      expect(diagnostics).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
