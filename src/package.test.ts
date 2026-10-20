// @vitest-environment node

import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Script } from 'node:vm';

import { ESLint } from 'eslint';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);

describe('package distribution', () => {
  it('requires cross-platform tests before the single release build and publication', async () => {
    const tests = load(await readFile(join(PACKAGE_ROOT, '.github/workflows/test.yml'), 'utf8'));

    expect(tests).toMatchObject({
      on: { workflow_call: null },
      jobs: {
        test: {
          strategy: { matrix: { os: ['ubuntu-latest', 'windows-latest', 'macos-latest'] } },
          steps: expect.arrayContaining([{ name: 'Test and enforce coverage', run: 'bun run test:ci' }]),
        },
      },
    });
    const publish = load(await readFile(join(PACKAGE_ROOT, '.github/workflows/publish.yml'), 'utf8'));

    expect(publish).toMatchObject({
      jobs: {
        test: { needs: 'validate-version', uses: './.github/workflows/test.yml' },
        publish: {
          needs: ['validate-version', 'test'],
          steps: expect.arrayContaining([
            { name: 'Build package', run: 'bun run build' },
            { name: 'Publish to npm', run: 'npm publish --ignore-scripts --access public --provenance' },
          ]),
        },
      },
    });
  });

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
    expect(manifest.engines.node).toBe('>=24');
    expect(manifest.dependencies).not.toHaveProperty('serve-static');
    expect(manifest.scripts.prepare).toBe('node bin/prepare.js');
    expect(await readFile(join(PACKAGE_ROOT, '.git-hooks/pre-push'), 'utf8')).toContain('bun run typecheck');
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

      const excludedTemplateFiles = [
        '.env.local',
        '.env.development.local',
        'private.pem',
        'dist/stale.js',
        'coverage/index.html',
        'node_modules/fixture/index.js',
        'public/assets/js/stale.js',
        'public/assets/css/stale.css',
        'public/pl-states.json',
      ];

      for (const file of excludedTemplateFiles) {
        const target = join(buildRoot, 'template', file);

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, 'fixture data that must not be published');
      }
      const packageManifest = JSON.parse(await readFile(join(buildRoot, 'package.json'), 'utf8'));
      // Publishing uses npm, whose ignore-file rules differ from Bun's packer.
      // Launch its JS CLI through Node to avoid Windows .cmd shell quoting.
      const { stdout: npmPaths } = await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['npm']);
      const npmShim = npmPaths.trim().split(/\r?\n/)[0]!;
      const npmCli = process.platform === 'win32' ? join(dirname(npmShim), 'node_modules/npm/bin/npm-cli.js') : await realpath(npmShim);
      const { stdout: packed } = await execFileAsync(
        process.execPath,
        [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
        { cwd: buildRoot }
      );
      const packResult = JSON.parse(packed);
      const archive = Array.isArray(packResult) ? packResult[0] : packResult[packageManifest.name];
      const archivePath = join(temporaryRoot, archive.filename);

      expect(archive.files.map((file: { path: string }) => file.path)).toEqual(
        expect.arrayContaining(['template/_gitignore', 'dist/types.d.ts', 'dist/assets/root.svg', 'dist/assets/pl-states.svg'])
      );
      const packedPaths = archive.files.map((file: { path: string }) => file.path);

      for (const file of excludedTemplateFiles) expect(packedPaths).not.toContain('template/' + file);
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
      const entryPoints = [
        ...Object.values(manifest.exports).flatMap((entry) => Object.values(entry as Record<string, string>)),
        manifest.bin.alveo,
        'dist/cli.js',
      ];

      for (const entryPoint of entryPoints) {
        await expect(access(join(installedRoot, entryPoint))).resolves.toBeUndefined();
      }

      await execFileAsync(process.execPath, [join(installedRoot, 'bin/cli.js'), 'create', './my-app'], { cwd: consumerRoot });
      const scaffold = JSON.parse(await readFile(join(consumerRoot, 'my-app/package.json'), 'utf8'));

      expect(scaffold.name).toBe('my-app');
      expect(scaffold.devDependencies.alveo).toBe(`^${manifest.version}`);
      await expect(access(join(consumerRoot, 'my-app/.gitignore'))).resolves.toBeUndefined();
      await execFileAsync('git', ['init', '--quiet'], { cwd: consumerRoot });
      const gitConfig = await readFile(join(consumerRoot, '.git/config'), 'utf8');

      await execFileAsync(process.execPath, [join(installedRoot, 'bin/prepare.js')], { cwd: consumerRoot });
      expect(await readFile(join(consumerRoot, '.git/config'), 'utf8')).toBe(gitConfig);

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
      await writeFile(join(scriptDirectory, 'probe.entry.ts'), 'globalThis.answer = (value: number) => value + 1;');
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

      await writeFile(
        consumerEntry,
        [
          "import type { ClientComponents, RootModel } from 'alveo';",
          "import { ReactSection } from 'alveo/helpers';",
          "import type { clientComponents as VirtualComponents } from 'virtual:alveo/client-components';",
          'export const clientComponents: ClientComponents = {};',
          'const virtual: typeof VirtualComponents = clientComponents;',
          'const model: RootModel = { routes: [] };',
          'viteAbsoluteUrl("/page"); getModifiers({}, "block");',
          'export const section = <ReactSection type="root" data={model} />;',
        ].join('\n')
      );
      for (const [module, moduleResolution] of [
        ['ESNext', 'Bundler'],
        ['Node16', 'Node16'],
        ['NodeNext', 'NodeNext'],
      ]) {
        // Run the consumer's own compiler from its own working directory.
        // createProgram in the maintainer process resolves explicit type-library
        // entries against the maintainer cwd, not against this isolated app.
        await execFileAsync(
          process.execPath,
          [
            join(consumerModules, 'typescript/bin/tsc'),
            '--target',
            'ESNext',
            '--module',
            module!,
            '--moduleResolution',
            moduleResolution!,
            '--jsx',
            'react-jsx',
            '--strict',
            '--skipLibCheck',
            'false',
            '--noEmit',
            '--types',
            'alveo/types,node',
            consumerEntry,
          ],
          { cwd: consumerRoot }
        );
      }

      // No consumer helper files, framework icons, or mock handlers are present.
      // Exercise the installed package's complete custom-mode pipeline, not only
      // mocked CLI subprocesses or a maintainer checkout with source fallbacks.
      const files: Record<string, string> = {
        'vite.config.ts':
          "import { defineAlveoConfig } from 'alveo'; export default defineAlveoConfig({ root: import.meta.dirname, base: '/subpath/', build: { manifest: true } });",
        '.env': 'VITE_BASE_URL=/ignored/\nVITE_INTE_ASSET_DIR=../integration/assets\nVITE_INTE_PATTERN_DIR=../integration/patterns\n',
        'index.html':
          '<html><head><title>Probe</title><link rel="stylesheet" href="#__BASE_URL__/assets/css/style-base.css"></head><body><!--app-html--><script type="module" src="/alveo/react-loader"></script><script type="module" src="#__BASE_URL__/assets/js/mock-api.js"></script></body></html>',
        'src/client-components.tsx': 'export const clientComponents = {};',
        'src/pages/Home.tsx': `import { createElement } from 'react'; export default function Home() { return createElement("p", null, ${JSON.stringify('Price $& $$')}); }`,
        'src/assets/scripts/main.entry.ts': 'globalThis.mainReady = true;\n',
        'src/assets/styles/00-abstracts/_abstracts.scss': '',
        'src/assets/styles/01-functions/_functions.scss': '',
        'src/assets/styles/01-mixins/_mixins.scss': '',
        'src/assets/styles/style-base.scss': '.probe { color: red; }\n',
      };

      for (const [file, content] of Object.entries(files)) {
        await mkdir(dirname(join(consumerRoot, file)), { recursive: true });
        await writeFile(join(consumerRoot, file), content);
      }
      for (const command of ['generate', 'inte']) {
        await execFileAsync(process.execPath, [join(installedRoot, 'bin/cli.js'), command, '--mode', 'eshn'], {
          cwd: consumerRoot,
          env: { ...process.env, NODE_ENV: 'production' },
          timeout: 60_000,
        });
      }
      expect(await readFile(join(consumerRoot, 'dist/static/pages/home.html'), 'utf8')).toContain('Price $&amp; $$');
      expect(await readFile(join(consumerRoot, 'dist/static/index.html'), 'utf8')).not.toContain('assets/js/mock-api.js');
      await expect(access(join(consumerRoot, 'public/pl-states.json'))).resolves.toBeUndefined();
      await expect(access(join(temporaryRoot, 'integration/assets/hashes.json'))).resolves.toBeUndefined();
      await expect(access(join(temporaryRoot, 'integration/patterns/pages-home.html'))).resolves.toBeUndefined();

      const staticRoot = join(consumerRoot, 'dist/static');
      const manifestGraph: Record<string, { file: string; imports?: string[] }> = JSON.parse(
        await readFile(join(staticRoot, '.vite/manifest.json'), 'utf8')
      );
      const eager = new Set<string>();
      const visit = (key: string) => {
        const chunk = manifestGraph[key];

        if (!chunk) throw new Error(`Missing manifest entry: ${key}`);
        if (eager.has(chunk.file)) return;
        eager.add(chunk.file);
        chunk.imports?.forEach(visit);
      };

      visit('index.html');
      const sources = async (file: string): Promise<string[]> => JSON.parse(await readFile(join(staticRoot, file + '.map'), 'utf8')).sources;
      const eagerSources = (await Promise.all([...eager].map(sources))).flat().join('\n');

      expect(eagerSources).not.toMatch(/js-yaml|cheerio|lodash/);
      const jsFiles = (await readdir(join(staticRoot, 'assets/js'))).filter((file) => file.endsWith('.js'));
      const allClientSources = (await Promise.all(jsFiles.map((file) => sources('assets/js/' + file)))).flat().join('\n');

      expect(allClientSources).not.toMatch(/cheerio|lodash/);
      expect(allClientSources).toContain('js-yaml');

      // Stage generated output without making a commit. Rebuilding CRLF source
      // must leave the actual integration bytes unchanged, not merely produce a
      // successful exit or a clean-looking Git status.
      await execFileAsync('git', ['init', '--quiet'], { cwd: temporaryRoot });
      await execFileAsync('git', ['add', 'integration'], { cwd: temporaryRoot });
      for (const [file, content] of Object.entries(files)) {
        await writeFile(join(consumerRoot, file), content.replaceAll('\n', '\r\n'));
      }
      await execFileAsync(process.execPath, [join(installedRoot, 'bin/cli.js'), 'inte', '--mode', 'eshn'], {
        cwd: consumerRoot,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 60_000,
      });
      const { stdout: changed } = await execFileAsync('git', ['diff', '--name-only', '--', 'integration/assets', 'integration/patterns'], {
        cwd: temporaryRoot,
      });

      expect(changed).toBe('');
      await execFileAsync('git', ['diff', '--quiet', '--', 'integration/assets', 'integration/patterns'], { cwd: temporaryRoot });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 240_000);
});
