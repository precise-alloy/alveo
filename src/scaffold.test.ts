// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { scaffoldProject, type ScaffoldDependencies } from './scaffold.ts';

const temporaryRoots: string[] = [];
const makeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-scaffold-'));

  temporaryRoots.push(root);
  const packageRoot = path.join(root, 'package');

  fs.mkdirSync(path.join(packageRoot, 'template'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"version":"9.8.7"}');
  fs.writeFileSync(path.join(packageRoot, 'template/package.json'), '{"name":"stale","devDependencies":{"alveo":"^0.1.0"}}');
  fs.writeFileSync(path.join(packageRoot, 'template/_gitignore'), 'node_modules/\n');

  return { cwd: root, packageRoot };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('scaffolding', () => {
  it('does not copy local configuration, packaging metadata, dependencies or generated output', () => {
    const options = makeFixture();
    const excluded = [
      '.npmignore',
      '.env.local',
      '.env.development.local',
      'local.pem',
      'app.tsbuildinfo',
      'vite.config.timestamp-1.mjs',
      '.DS_Store',
      'npm-debug.log',
      'yarn-error.log',
      'node_modules/dependency/index.js',
      '.git/config',
      'dist/old.js',
      'coverage/index.html',
      'build/old.js',
      'out/old.js',
      '.next/old.js',
      '.turbo/state',
      'public/assets/js/stale.js',
      'public/assets/css/stale.css',
      'public/pl-states.json',
    ];
    const included = ['src/main.ts', '.env', 'public/assets/images/logo.svg', 'public/assets/fonts/font.woff', 'public/assets/vendors/library.js'];

    for (const file of [...excluded, ...included]) {
      const target = path.join(options.packageRoot, 'template', file);

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'fixture data');
    }
    const target = scaffoldProject('app', options);

    for (const file of excluded) expect(fs.existsSync(path.join(target, file)), file).toBe(false);
    for (const file of included) expect(fs.readFileSync(path.join(target, file), 'utf8'), file).toBe('fixture data');
  });

  it.each(['./my-app', 'nested/../my-app'])('derives a valid name from %s and uses the running release', (name) => {
    const options = makeFixture();
    const target = scaffoldProject(name, options);

    expect(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))).toEqual({
      name: 'my-app',
      devDependencies: { alveo: '^9.8.7' },
    });
    expect(fs.readFileSync(path.join(target, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(fs.existsSync(path.join(target, '_gitignore'))).toBe(false);
  });

  it('accepts an existing empty directory and normalizes spaces and case', () => {
    const options = makeFixture();

    fs.mkdirSync(path.join(options.cwd, 'My App'));
    const target = scaffoldProject('My App', options);

    expect(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name).toBe('my-app');
  });

  it.each(['bad$&name', '_private', 'x'.repeat(215)])('rejects invalid package names without copying files', (name) => {
    const options = makeFixture();

    expect(() => scaffoldProject(name, options)).toThrow('valid package-name');
    expect(fs.existsSync(path.join(options.cwd, name))).toBe(false);
  });

  it('refuses to overwrite nonempty directories', () => {
    const options = makeFixture();

    expect(() => scaffoldProject('package', options)).toThrow('not empty');
  });

  it('reports a missing template', () => {
    const options = makeFixture();

    expect(() => scaffoldProject('app', { ...options, packageRoot: path.join(options.cwd, 'absent') })).toThrow('template is missing');
  });

  it('checks Bun before writing and installs with argument arrays', () => {
    const options = makeFixture();
    const execFileSync = vi.fn().mockReturnValue(Buffer.alloc(0));
    const dependencies: ScaffoldDependencies = { ...fs, execFileSync };
    const target = scaffoldProject('app', { ...options, install: true }, dependencies);

    expect(execFileSync.mock.calls).toEqual([
      ['bun', ['--version'], { stdio: 'ignore' }],
      ['bun', ['install'], { cwd: target, stdio: 'inherit' }],
    ]);
  });

  it('reports missing Bun without leaving a partial project', () => {
    const options = makeFixture();
    const cause = new Error('ENOENT');
    const dependencies: ScaffoldDependencies = {
      ...fs,
      execFileSync: vi.fn(() => {
        throw cause;
      }),
    };

    expect(() => scaffoldProject('app', { ...options, install: true }, dependencies)).toThrow('Bun is required');
    expect(fs.existsSync(path.join(options.cwd, 'app'))).toBe(false);
  });

  it('propagates install and filesystem failures', () => {
    const options = makeFixture();
    const execFileSync = vi
      .fn()
      .mockReturnValueOnce(Buffer.alloc(0))
      .mockImplementationOnce(() => {
        throw new Error('install failed');
      });

    expect(() => scaffoldProject('app', { ...options, install: true }, { ...fs, execFileSync })).toThrow('install failed');
    fs.writeFileSync(path.join(options.packageRoot, 'template/package.json'), '{');
    expect(() => scaffoldProject('second', options)).toThrow(SyntaxError);
  });

  it('supports the default checkout and working directory without installation', () => {
    const options = makeFixture();

    vi.spyOn(process, 'cwd').mockReturnValue(options.cwd);
    const target = scaffoldProject('app');

    expect(fs.existsSync(path.join(target, '.gitignore'))).toBe(true);
  });
});
