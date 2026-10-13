import path from 'path';
import { execFileSync, type ExecSyncOptions } from 'child_process';
import { createRequire } from 'module';

import { Command } from 'commander';

import { resolveViteCliPath } from './dev-supervisor.ts';
import { getPackageRoot } from './paths.ts';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const ssrEntry = path.resolve(getPackageRoot(), 'dist', 'entry-server.js');

function resolveRoot(root?: string): string {
  if (root) {
    return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  }

  return process.cwd();
}

const isWindows = process.platform === 'win32';

// Package-manager commands may use .cmd wrappers on Windows. Vite is launched
// directly through Node below, so its path never depends on shell resolution.
function exec(command: string, options: ExecSyncOptions, args?: string[]): void {
  execFileSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
}

function viteBuild(projectRoot: string, mode: string, outDir: string, ssr?: string): void {
  const args = [resolveViteCliPath(), 'build', '--outDir', outDir, '--mode', mode];

  if (ssr) {
    args.push('--ssr', ssr);
  }

  // A consumer using isolated dependencies has no top-level Vite executable.
  // Use Alveo's declared version without npx downloads or a consumer override.
  execFileSync(process.execPath, args, { cwd: projectRoot, stdio: 'inherit' });
}

async function runPrerender(projectRoot: string, mode: string, { addHash = false } = {}): Promise<boolean> {
  const { prerender } = await import('./prerender.ts');

  console.log('[alveo] Pre-rendering...');
  const result = await prerender(projectRoot, { mode, addHash });

  if (result.missing.length > 0) {
    console.error('[alveo] Pre-render failed. Missing files:\n' + result.missing.join('\n'));
    process.exitCode = 1;

    return false;
  }

  return true;
}

const program = new Command();

program.name('alveo').description('Opinionated React SSR framework built on Vite').version(pkg.version);

// ── dev ──────────────────────────────────────────────────────────────
program
  .command('dev')
  .description('Start development server with hot reload')
  .option('--root <path>', 'project root directory')
  .option('--port <port>', 'server port')
  .option('--mode <mode>', 'Vite mode', 'development')
  .action(async (options: { root?: string; port?: string; mode: string }) => {
    const projectRoot = resolveRoot(options.root);
    const { assertMode, buildDevProcesses, parsePort, spawnSupervisor } = await import('./dev-supervisor.ts');

    try {
      const mode = assertMode(options.mode);
      const port = options.port ? parsePort(options.port) : undefined;
      const exitCode = await spawnSupervisor(buildDevProcesses({ projectRoot, mode, port }));

      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    } catch (error) {
      console.error('[alveo] Dev command failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });

// ── build ────────────────────────────────────────────────────────────
program
  .command('build')
  .description('Production build (static + SSR)')
  .option('--root <path>', 'project root directory')
  .option('--mode <mode>', 'Vite mode', 'production')
  .option('--outDir <dir>', 'output directory', 'dist')
  .action((options: { root?: string; mode: string; outDir: string }) => {
    const projectRoot = resolveRoot(options.root);
    const outStatic = path.join(options.outDir, 'static');
    const outServer = path.join(options.outDir, 'server');

    console.log('[alveo] Building static bundle...');
    viteBuild(projectRoot, options.mode, outStatic);

    console.log('[alveo] Building SSR bundle...');
    viteBuild(projectRoot, options.mode, outServer, ssrEntry);

    console.log('[alveo] Build complete.');
  });

// ── generate ─────────────────────────────────────────────────────────
program
  .command('generate')
  .description('Full prerender pipeline: states, styles, build, prerender')
  .option('--root <path>', 'project root directory')
  .option('--mode <mode>', 'Vite mode', 'production')
  .action(async (options: { root?: string; mode: string }) => {
    const projectRoot = resolveRoot(options.root);
    const { runStatesBuild } = await import('./states.ts');
    const { runStyleBuild } = await import('./styles.ts');

    console.log('[alveo] Running states...');
    const stateResult = runStatesBuild({ projectRoot });

    if ('ok' in stateResult && !stateResult.ok) {
      console.error('[alveo] States build failed:', stateResult.errors);
      process.exitCode = 1;

      return;
    }

    console.log('[alveo] Running styles...');
    await runStyleBuild({ projectRoot });

    console.log('[alveo] Building...');
    viteBuild(projectRoot, options.mode, path.join('dist', 'static'));
    viteBuild(projectRoot, options.mode, path.join('dist', 'server'), ssrEntry);

    if (!(await runPrerender(projectRoot, options.mode, { addHash: true }))) return;

    console.log('[alveo] Generate complete.');
  });

// ── inte ─────────────────────────────────────────────────────────────
program
  .command('inte')
  .description('Integration build for backend consumption')
  .option('--root <path>', 'project root directory')
  .option('--mode <mode>', 'Vite mode', 'production')
  .action(async (options: { root?: string; mode: string }) => {
    const projectRoot = resolveRoot(options.root);
    const { runStyleBuild } = await import('./styles.ts');
    const { runIntegration } = await import('./integration.ts');

    console.log('[alveo] Running styles...');
    await runStyleBuild({ projectRoot });

    console.log('[alveo] Building...');
    viteBuild(projectRoot, options.mode, path.join('dist', 'static'));
    viteBuild(projectRoot, options.mode, path.join('dist', 'server'), ssrEntry);

    if (!(await runPrerender(projectRoot, options.mode))) return;

    console.log('[alveo] Running integration...');
    const result = runIntegration({ projectRoot });

    if (!result.isValid) {
      console.error('[alveo] Integration validation failed. Missing files:', result.missing);
      process.exitCode = 1;

      return;
    }

    console.log('[alveo] Integration complete.');
  });

// ── styles ───────────────────────────────────────────────────────────
program
  .command('styles')
  .description('Compile SCSS stylesheets')
  .option('--root <path>', 'project root directory')
  .option('--watch', 'watch for changes')
  .action(async (options: { root?: string; watch?: boolean }) => {
    const projectRoot = resolveRoot(options.root);
    const { runStyleBuild } = await import('./styles.ts');

    runStyleBuild({ projectRoot, isWatch: options.watch });
  });

// ── scripts ──────────────────────────────────────────────────────────
program
  .command('scripts')
  .description('Compile asset scripts')
  .option('--root <path>', 'project root directory')
  .option('--watch', 'watch for changes')
  .action(async (options: { root?: string; watch?: boolean }) => {
    const projectRoot = resolveRoot(options.root);
    const { runScriptBuild } = await import('./scripts.ts');
    const result = await runScriptBuild(projectRoot, options.watch ? ['--watch'] : []);

    if (!options.watch && 'ok' in result && !result.ok) {
      console.error('[alveo] Scripts build failed:', result.errors);
      process.exitCode = 1;
    }
  });

// ── states ───────────────────────────────────────────────────────────
program
  .command('states')
  .description('Aggregate component states')
  .option('--root <path>', 'project root directory')
  .option('--watch', 'watch for changes')
  .action(async (options: { root?: string; watch?: boolean }) => {
    const projectRoot = resolveRoot(options.root);
    const { runStatesBuild } = await import('./states.ts');

    const stateResult = runStatesBuild({ projectRoot, isWatch: options.watch });

    if (!options.watch && 'ok' in stateResult && !stateResult.ok) {
      console.error('[alveo] States build failed:', stateResult.errors);
      process.exitCode = 1;
    }
  });

// ── server ───────────────────────────────────────────────────────────
program
  .command('server')
  .description('Start the Express SSR server')
  .option('--root <path>', 'project root directory')
  .option('--mode <mode>', 'Vite mode', 'production')
  .option('--port <port>', 'server port')
  .action(async (options: { root?: string; mode: string; port?: string }) => {
    const projectRoot = resolveRoot(options.root);
    const { initServer } = await import('./server.ts');

    // Ensure mode is available in process.argv for initServer
    if (options.mode) {
      const modeIdx = process.argv.indexOf('--mode');

      if (modeIdx === -1) {
        process.argv.push('--mode', options.mode);
      }
    }

    if (options.port) {
      process.env.VITE_PORT = options.port;
    }

    initServer(projectRoot);
  });

// ── create ──────────────────────────────────────────────────────────
program
  .command('create')
  .description('Scaffold a new alveo project from the starter template')
  .argument('<project-name>', 'name of the project directory to create')
  .option('--install', 'run package manager install after scaffolding')
  .action(async (projectName: string, options: { install?: boolean }) => {
    const fs = await import('fs');
    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
      const entries = fs.readdirSync(targetDir);

      if (entries.length > 0) {
        console.error(`[alveo] Directory "${projectName}" already exists and is not empty.`);
        process.exitCode = 1;

        return;
      }
    }

    const templateDir = path.resolve(getPackageRoot(), 'template');

    if (!fs.existsSync(templateDir)) {
      console.error('[alveo] Template directory not found. Ensure the alveo package includes the template/ directory.');
      process.exitCode = 1;

      return;
    }

    console.log(`[alveo] Creating project in ${targetDir}...`);
    fs.cpSync(templateDir, targetDir, { recursive: true });

    const pkgJsonPath = path.join(targetDir, 'package.json');

    // Use a file descriptor to read-then-write atomically on the same handle,
    // avoiding a TOCTOU race between separate readFileSync/writeFileSync calls.
    // Truncate before writing because the replaced content may be shorter.
    try {
      const fd = fs.openSync(pkgJsonPath, fs.constants.O_RDWR);

      try {
        const content = fs.readFileSync(fd, 'utf-8');
        const updated = content.replace('{{PROJECT_NAME}}', projectName);

        fs.ftruncateSync(fd);
        fs.writeSync(fd, updated, 0, 'utf-8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      console.log('[alveo] cannot write template files');
      process.exitCode = 1;

      return;
    }

    console.log('[alveo] Project scaffolded successfully!\n');

    if (options.install) {
      console.log('[alveo] Installing dependencies...');
      exec('bun', { cwd: targetDir }, ['install']);
    } else {
      console.log('Next steps:');
      console.log(`  cd ${projectName}`);
      console.log('  bun install');
      console.log('  bun run dev');
    }
  });

program.parse();
