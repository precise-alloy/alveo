/* eslint-disable no-console */

import path from 'path';
import { execSync, type ExecSyncOptions } from 'child_process';
import { createRequire } from 'module';

import { Command } from 'commander';

import { getPackageRoot } from './paths.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const ssrEntry = path.resolve(getPackageRoot(), 'src', 'entry-server.tsx');

function resolveRoot(root?: string): string {
  if (root) {
    return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  }

  return process.cwd();
}

function exec(cmd: string, options: ExecSyncOptions): void {
  execSync(cmd, { stdio: 'inherit', ...options });
}

function viteBuild(projectRoot: string, mode: string, outDir: string, ssr?: string): void {
  const ssrArg = ssr ? ` --ssr ${ssr}` : '';

  exec(`npx vite build --outDir ${outDir} --mode ${mode}${ssrArg}`, { cwd: projectRoot });
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
    const concurrently = (await import('concurrently')).default;

    const portArgs = options.port ? ` --port ${options.port}` : '';
    const npxCmd = 'npx';

    const { result } = concurrently(
      [
        {
          command: `${npxCmd} alveo styles --watch --root "${projectRoot}"`,
          name: 'styles',
          prefixColor: 'blue',
        },
        {
          command: `${npxCmd} alveo states --watch --root "${projectRoot}"`,
          name: 'states',
          prefixColor: 'green',
        },
        {
          command: `${npxCmd} vite build --mode ${options.mode} --watch`,
          name: 'vite',
          prefixColor: 'yellow',
          cwd: projectRoot,
          env: { ...process.env, scriptOnly: 'true' },
        },
        {
          command: `${npxCmd} alveo server --mode ${options.mode}${portArgs} --root "${projectRoot}"`,
          name: 'server',
          prefixColor: 'magenta',
        },
      ],
      { killOthersOn: ['failure'] }
    );

    try {
      await result;
    } catch {
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
    const { runStatesBuild } = await import('./states.js');
    const { runStyleBuild } = await import('./styles.js');
    const { prerender } = await import('./prerender.js');

    console.log('[alveo] Running states...');
    runStatesBuild({ projectRoot });

    console.log('[alveo] Running styles...');
    await runStyleBuild({ projectRoot });

    console.log('[alveo] Building...');
    viteBuild(projectRoot, options.mode, path.join('dist', 'static'));
    viteBuild(projectRoot, options.mode, path.join('dist', 'server'), ssrEntry);

    console.log('[alveo] Pre-rendering...');
    process.argv = ['node', 'alveo', '--add-hash', '--mode', options.mode];
    await prerender(projectRoot);

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
    const { runStyleBuild } = await import('./styles.js');
    const { prerender } = await import('./prerender.js');
    const { runIntegration } = await import('./integration.js');

    console.log('[alveo] Running styles...');
    await runStyleBuild({ projectRoot });

    console.log('[alveo] Building...');
    viteBuild(projectRoot, options.mode, path.join('dist', 'static'));
    viteBuild(projectRoot, options.mode, path.join('dist', 'server'), ssrEntry);

    console.log('[alveo] Pre-rendering...');
    process.argv = ['node', 'alveo', '--mode', options.mode];
    await prerender(projectRoot);

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
    const { runStyleBuild } = await import('./styles.js');

    runStyleBuild({ projectRoot, isWatch: options.watch });
  });

// ── states ───────────────────────────────────────────────────────────
program
  .command('states')
  .description('Aggregate component states')
  .option('--root <path>', 'project root directory')
  .option('--watch', 'watch for changes')
  .action(async (options: { root?: string; watch?: boolean }) => {
    const projectRoot = resolveRoot(options.root);
    const { runStatesBuild } = await import('./states.js');

    runStatesBuild({ projectRoot, isWatch: options.watch });
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
    const { initServer } = await import('./server.js');

    // Ensure mode is available in process.argv for initServer
    if (options.mode) {
      const modeIdx = process.argv.indexOf('--mode');

      if (modeIdx === -1) {
        process.argv.push('--mode', options.mode);
      }
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

    if (fs.existsSync(pkgJsonPath)) {
      const content = fs.readFileSync(pkgJsonPath, 'utf-8');

      fs.writeFileSync(pkgJsonPath, content.replace('{{PROJECT_NAME}}', projectName));
    }

    console.log('[alveo] Project scaffolded successfully!\n');

    if (options.install) {
      console.log('[alveo] Installing dependencies...');
      exec('bun install', { cwd: targetDir });
    } else {
      console.log('Next steps:');
      console.log(`  cd ${projectName}`);
      console.log('  bun install');
      console.log('  bun run dev');
    }
  });

program.parse();
