// @vitest-environment node

import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);

describe('package distribution', () => {
  it('builds a clean tarball with resolvable consumer types and runtime exports', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'alveo-package-'));
    const buildRoot = join(temporaryRoot, 'build');
    const consumerRoot = join(temporaryRoot, 'consumer');
    const consumerModules = join(consumerRoot, 'node_modules');
    const installedRoot = join(consumerModules, 'alveo');
    const archivePath = join(temporaryRoot, 'alveo.tgz');
    const dependencies = join(PACKAGE_ROOT, 'node_modules');

    try {
      // A developer's existing dist can hide a check-only build, as in 0.3.0.
      // Copy build inputs only and reuse installed dependencies to keep this
      // release check offline without letting stale output satisfy the exports.
      await mkdir(buildRoot);
      for (const entry of ['package.json', 'tsconfig.json', '.npmignore', 'src', 'bin', 'template', 'README.md', 'LICENSE']) {
        await cp(join(PACKAGE_ROOT, entry), join(buildRoot, entry), { recursive: true });
      }
      await symlink(dependencies, join(buildRoot, 'node_modules'), 'junction');
      await execFileAsync('bun', ['run', 'build'], { cwd: buildRoot });

      // Exercise the package allowlist, not just the build directory. The Git
      // prepare hook must not run inside this disposable, non-Git checkout.
      await execFileAsync('bun', ['pm', 'pack', '--ignore-scripts', '--quiet', '--filename', archivePath], { cwd: buildRoot });
      await mkdir(consumerModules, { recursive: true });
      await execFileAsync('bun', [
        '--eval',
        'await new Bun.Archive(await Bun.file(process.argv[1]).arrayBuffer()).extract(process.argv[2]);',
        archivePath,
        consumerModules,
      ]);
      await rename(join(consumerModules, 'package'), installedRoot);

      const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
      const entryPoints = [...Object.values(manifest.exports['.']), manifest.bin.alveo, 'dist/cli.js'] as string[];

      for (const entryPoint of entryPoints) {
        await expect(access(join(installedRoot, entryPoint))).resolves.toBeUndefined();
      }

      // Resolve through the extracted package's export map, without source
      // aliases or a source-tree link that could conceal missing declarations.
      await symlink(dependencies, join(installedRoot, 'node_modules'), 'junction');
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
      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "import { createPaths } from 'alveo'; if (typeof createPaths !== 'function') throw new Error('Missing runtime export');",
        ],
        { cwd: consumerRoot }
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
