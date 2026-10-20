// @vitest-environment node
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  styles: vi.fn(),
  states: vi.fn(),
  scripts: vi.fn(),
  prerender: vi.fn(),
  integration: vi.fn(),
  server: vi.fn(),
  scaffold: vi.fn(),
  supervisor: vi.fn(),
}));

vi.mock('child_process', async (original) => ({ ...(await original<typeof import('child_process')>()), execFileSync: mocks.exec }));
vi.mock('./styles.ts', () => ({ runStyleBuild: mocks.styles }));
vi.mock('./states.ts', () => ({ runStatesBuild: mocks.states }));
vi.mock('./scripts.ts', () => ({ runScriptBuild: mocks.scripts }));
vi.mock('./prerender.ts', () => ({ prerender: mocks.prerender }));
vi.mock('./integration.ts', () => ({ runIntegration: mocks.integration }));
vi.mock('./server.ts', () => ({ initServer: mocks.server }));
vi.mock('./scaffold.ts', () => ({ scaffoldProject: mocks.scaffold }));
vi.mock('./dev-supervisor.ts', async (original) => ({
  ...(await original<typeof import('./dev-supervisor.ts')>()),
  resolveViteCliPath: () => '/vite/cli.js',
  buildDevProcesses: () => [],
  spawnSupervisor: mocks.supervisor,
}));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const run = async (...args: string[]) => {
  process.argv = [process.execPath, 'alveo', ...args];
  vi.resetModules();
  await import('./cli.ts');
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.styles.mockResolvedValue(undefined);
  mocks.states.mockReturnValue({ ok: true, errors: [] });
  mocks.scripts.mockResolvedValue({ ok: true, errors: [] });
  mocks.prerender.mockResolvedValue({ missing: [] });
  mocks.integration.mockReturnValue({ isValid: true, missing: [] });
  mocks.supervisor.mockResolvedValue(0);
  mocks.scaffold.mockReturnValue('/project/app');
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
});

describe('CLI pipeline failures and sequencing', () => {
  it.each(['generate', 'inte'])('%s stops before Vite, rendering, or integration when styles fail', async (command) => {
    mocks.styles.mockRejectedValue(new Error('bad Sass'));
    await run(command, '--root', '/project');
    expect(process.exitCode).toBe(1);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.prerender).not.toHaveBeenCalled();
    expect(mocks.integration).not.toHaveBeenCalled();
  });
  it.each(['generate', 'inte'])('%s runs states and stops if state aggregation fails', async (command) => {
    mocks.states.mockReturnValue({ ok: false, errors: ['invalid state'] });
    await run(command);
    expect(process.exitCode).toBe(1);
    expect(mocks.styles).not.toHaveBeenCalled();
  });
  it.each(['generate', 'inte'])('%s stops on missing prerender resources', async (command) => {
    mocks.prerender.mockResolvedValue({ missing: ['missing.css'] });
    await run(command);
    expect(process.exitCode).toBe(1);
    expect(mocks.integration).not.toHaveBeenCalled();
  });
  it('runs successful generation and integration with the requested mode', async () => {
    await run('generate', '--root', 'app');
    expect(mocks.states).toHaveBeenCalledWith({ projectRoot: path.resolve('app') });
    expect(mocks.prerender).toHaveBeenCalledWith(path.resolve('app'), { mode: 'production', addHash: true });
    await run('inte', '--root', '/project', '--mode', 'eshn');
    expect(mocks.integration).toHaveBeenCalledWith({ projectRoot: '/project', argv: ['--mode', 'eshn'] });
    expect(process.exitCode).toBeUndefined();
  });
  it('reports integration validation errors', async () => {
    mocks.integration.mockReturnValue({ isValid: false, missing: ['missing.js'] });
    await run('inte');
    expect(process.exitCode).toBe(1);
  });
  it('runs both Vite builds with their proper outputs', async () => {
    await run('build', '--outDir', 'output');
    expect(mocks.exec).toHaveBeenCalledTimes(2);
    expect(mocks.exec.mock.calls[0]![1]).toContain(path.join('output', 'static'));
    expect(mocks.exec.mock.calls[1]![1]).toContain('--ssr');
  });
  it('awaits styles and reports errors through the command boundary', async () => {
    mocks.styles.mockRejectedValue(new Error('late style failure'));
    await run('styles', '--watch');
    expect(process.exitCode).toBe(1);
  });
  it.each(['scripts', 'states'])('reports %s build failures while supporting watch mode', async (command) => {
    mocks[command].mockResolvedValue({ ok: false, errors: ['failed'] });
    if (command === 'states') mocks.states.mockReturnValue({ ok: false, errors: ['failed'] });
    await run(command);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await run(command, '--watch');
    expect(process.exitCode).toBeUndefined();
  });
  it('passes server options explicitly and supports both scaffolding paths', async () => {
    await run('server', '--mode', 'eshn', '--port', '5005');
    expect(mocks.server).toHaveBeenCalledWith(process.cwd(), { mode: 'eshn', port: '5005' });
    await run('create', './app');
    await run('create', './installed', '--install');
    expect(mocks.scaffold).toHaveBeenCalledWith('./installed', { install: true });
  });
  it('handles dev success, child failure, invalid modes and invalid ports', async () => {
    await run('dev');
    await run('dev', '--port', '5050');
    expect(process.exitCode).toBeUndefined();
    mocks.supervisor.mockResolvedValue(7);
    await run('dev');
    expect(process.exitCode).toBe(7);
    await run('dev', '--mode', 'invalid mode');
    expect(process.exitCode).toBe(1);
    await run('dev', '--port', 'oops');
    expect(process.exitCode).toBe(1);
  });
});
