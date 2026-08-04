// @vitest-environment node

import { EventEmitter } from 'events';

import { describe, expect, it, vi } from 'vitest';

import {
  assertMode,
  buildDevProcesses,
  colorizePrefix,
  DevProcessSpec,
  DevSupervisorDependencies,
  formatProcessOutput,
  parsePort,
  resolveAlveoCliPath,
  resolveViteCliPath,
  SpawnedDevProcess,
  spawnSupervisor,
} from './dev-supervisor.ts';

class MockProcess extends EventEmitter implements SpawnedDevProcess {
  stdout: NodeJS.ReadableStream | null = new EventEmitter() as NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream | null = new EventEmitter() as NodeJS.ReadableStream;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;

    return true;
  });
}

const buildDependencies = (processes: MockProcess[]): DevSupervisorDependencies => ({
  spawnProcess: vi.fn(() => processes.shift()!) as never,
  stdoutWrite: vi.fn(),
  stderrWrite: vi.fn(),
  processOn: vi.fn(),
  processOff: vi.fn(),
});

describe('alveo/dev-supervisor.ts', () => {
  describe('parsePort', () => {
    it('accepts valid TCP ports', () => {
      expect(parsePort('1')).toBe(1);
      expect(parsePort('65535')).toBe(65535);
    });

    it('rejects non-integer and out-of-range ports', () => {
      expect(() => parsePort('abc')).toThrow('--port must be an integer between 1 and 65535');
      expect(() => parsePort('1.5')).toThrow('--port must be an integer between 1 and 65535');
      expect(() => parsePort('0')).toThrow('--port must be an integer between 1 and 65535');
      expect(() => parsePort('70000')).toThrow('--port must be an integer between 1 and 65535');
    });
  });

  describe('assertMode', () => {
    it('accepts conservative mode tokens', () => {
      expect(assertMode('development')).toBe('development');
      expect(assertMode('preview.local_1')).toBe('preview.local_1');
    });

    it('rejects mode values with spaces or shell metacharacters', () => {
      expect(() => assertMode('a b')).toThrow('--mode may only contain letters, numbers, dots, underscores, and hyphens');
      expect(() => assertMode('; rm -rf')).toThrow('--mode may only contain letters, numbers, dots, underscores, and hyphens');
    });
  });

  describe('binary resolution', () => {
    it('resolves JS entrypoints instead of shell shims', () => {
      expect(resolveAlveoCliPath('/package')).toContain('bin/cli.js');
      expect(resolveViteCliPath()).toContain('vite');
    });
  });

  describe('buildDevProcesses', () => {
    it('builds argv-array process specs without shell command strings', () => {
      const projectRoot = '/project/root with "quotes"';
      const specs = buildDevProcesses({
        projectRoot,
        mode: 'development',
        port: 5173,
        env: { PATH: '/bin' },
        nodeCommand: '/node',
        alveoCliPath: '/package/bin/cli.js',
        viteCliPath: '/package/node_modules/vite/bin/vite.js',
      });

      expect(specs).toHaveLength(4);
      specs.forEach((spec) => {
        expect(spec.command).toBe('/node');
        expect(Array.isArray(spec.args)).toBe(true);
      });
      expect(specs.filter((spec) => spec.name !== 'vite').every((spec) => spec.args.includes(projectRoot))).toBe(true);
      expect(specs.find((spec) => spec.name === 'server')?.args).toEqual([
        '/package/bin/cli.js',
        'server',
        '--mode',
        'development',
        '--port',
        '5173',
        '--root',
        projectRoot,
      ]);
      expect(specs.find((spec) => spec.name === 'vite')).toEqual(
        expect.objectContaining({
          args: ['/package/node_modules/vite/bin/vite.js', 'build', '--mode', 'development', '--watch'],
          cwd: projectRoot,
          env: { PATH: '/bin', scriptOnly: 'true' },
        })
      );
    });

    it('omits server port args when no port is provided', () => {
      const specs = buildDevProcesses({
        projectRoot: '/project',
        mode: 'development',
        env: {},
        nodeCommand: '/node',
        alveoCliPath: '/cli.js',
        viteCliPath: '/vite.js',
      });
      const serverSpec = specs.find((spec) => spec.name === 'server');

      expect(serverSpec?.command).toBe('/node');
      expect(serverSpec?.args).toEqual(['/cli.js', 'server', '--mode', 'development', '--root', '/project']);
    });
  });

  describe('formatProcessOutput', () => {
    it('prefixes each output line', () => {
      expect(formatProcessOutput('vite', undefined, 'one\ntwo\n')).toBe('[vite] one\n[vite] two\n');
    });

    it('ignores empty output chunks', () => {
      expect(formatProcessOutput('vite', undefined, '')).toBe('');
    });

    it('supports configured prefix colors', () => {
      expect(colorizePrefix('[styles]', 'blue')).toContain('[styles]');
      expect(colorizePrefix('[states]', 'green')).toContain('[states]');
      expect(colorizePrefix('[vite]', 'yellow')).toContain('[vite]');
      expect(colorizePrefix('[server]', 'magenta')).toContain('[server]');
    });
  });

  describe('spawnSupervisor', () => {
    it('returns zero when there are no process specs', async () => {
      await expect(spawnSupervisor([], buildDependencies([]))).resolves.toBe(0);
    });

    it('spawns each process without a shell and forwards prefixed output', async () => {
      const firstProcess = new MockProcess();
      const secondProcess = new MockProcess();
      const deps = buildDependencies([firstProcess, secondProcess]);
      const specs: DevProcessSpec[] = [
        { name: 'styles', command: 'npx', args: ['alveo', 'styles'], prefixColor: 'blue' },
        { name: 'vite', command: 'npx', args: ['vite', 'build'], cwd: '/project', env: { scriptOnly: 'true' }, prefixColor: 'yellow' },
      ];
      const resultPromise = spawnSupervisor(specs, deps);

      firstProcess.stdout!.emit('data', Buffer.from('ready\n'));
      secondProcess.stderr!.emit('data', Buffer.from('warn\n'));
      firstProcess.emit('exit', 0, null);
      secondProcess.emit('exit', 0, null);

      await expect(resultPromise).resolves.toBe(0);
      expect(deps.spawnProcess).toHaveBeenCalledWith('npx', ['alveo', 'styles'], {
        cwd: undefined,
        env: undefined,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(deps.spawnProcess).toHaveBeenCalledWith('npx', ['vite', 'build'], {
        cwd: '/project',
        env: { scriptOnly: 'true' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect((deps.stdoutWrite as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('[styles]');
      expect((deps.stdoutWrite as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('ready');
      expect((deps.stderrWrite as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('[vite]');
      expect((deps.stderrWrite as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('warn');
      expect(deps.processOff).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(deps.processOff).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('kills sibling processes and returns non-zero when one process fails', async () => {
      const failedProcess = new MockProcess();
      const siblingProcess = new MockProcess();
      const deps = buildDependencies([failedProcess, siblingProcess]);
      const resultPromise = spawnSupervisor(
        [
          { name: 'styles', command: 'npx', args: ['alveo', 'styles'] },
          { name: 'server', command: 'npx', args: ['alveo', 'server'] },
        ],
        deps
      );

      failedProcess.emit('exit', 2, null);
      siblingProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(2);
      expect(siblingProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does not kill siblings that are already marked killed', async () => {
      const failedProcess = new MockProcess();
      const siblingProcess = new MockProcess();
      const deps = buildDependencies([failedProcess, siblingProcess]);

      siblingProcess.killed = true;
      const resultPromise = spawnSupervisor(
        [
          { name: 'styles', command: 'node', args: ['/cli.js', 'styles'] },
          { name: 'server', command: 'node', args: ['/cli.js', 'server'] },
        ],
        deps
      );

      failedProcess.emit('exit', 2, null);
      siblingProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(2);
      expect(siblingProcess.kill).not.toHaveBeenCalled();
    });

    it('treats spawn errors as failures and ignores duplicate exits', async () => {
      const failedProcess = new MockProcess();
      const deps = buildDependencies([failedProcess]);
      const resultPromise = spawnSupervisor([{ name: 'states', command: 'npx', args: ['alveo', 'states'] }], deps);

      failedProcess.emit('error', new Error('spawn failed'));
      failedProcess.emit('exit', 0, null);

      await expect(resultPromise).resolves.toBe(1);
      expect(deps.stderrWrite).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
    });

    it('kills already-spawned processes when a later spawn throws', async () => {
      const spawnedProcess = new MockProcess();
      const deps = buildDependencies([]);

      (deps.spawnProcess as ReturnType<typeof vi.fn>).mockReturnValueOnce(spawnedProcess).mockImplementationOnce(() => {
        throw new Error('sync spawn failed');
      });

      const resultPromise = spawnSupervisor(
        [
          { name: 'styles', command: 'node', args: ['/cli.js', 'styles'] },
          { name: 'server', command: 'node', args: ['/cli.js', 'server'] },
        ],
        deps
      );

      spawnedProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(1);
      expect(spawnedProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(deps.stderrWrite).toHaveBeenCalledWith(expect.stringContaining('sync spawn failed'));
    });

    it('reports non-error synchronous spawn failures', async () => {
      const deps = buildDependencies([]);

      (deps.spawnProcess as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw 'sync spawn failed';
      });

      await expect(spawnSupervisor([{ name: 'styles', command: 'node', args: ['/cli.js', 'styles'] }], deps)).resolves.toBe(1);
      expect(deps.stderrWrite).toHaveBeenCalledWith(expect.stringContaining('sync spawn failed'));
    });

    it('terminates active processes on parent termination signals', async () => {
      const childProcess = new MockProcess();
      const deps = buildDependencies([childProcess]);
      const resultPromise = spawnSupervisor([{ name: 'server', command: 'node', args: ['/cli.js', 'server'] }], deps);
      const sigintListener = (deps.processOn as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === 'SIGINT')?.[1] as () => void;

      sigintListener();
      childProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(130);
      expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('uses the conventional SIGTERM exit code for termination signals', async () => {
      const childProcess = new MockProcess();
      const deps = buildDependencies([childProcess]);
      const resultPromise = spawnSupervisor([{ name: 'server', command: 'node', args: ['/cli.js', 'server'] }], deps);
      const sigtermListener = (deps.processOn as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === 'SIGTERM')?.[1] as () => void;

      sigtermListener();
      childProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(143);
    });

    it('escalates child termination when a second parent signal arrives', async () => {
      const childProcess = new MockProcess();
      const deps = buildDependencies([childProcess]);
      const resultPromise = spawnSupervisor([{ name: 'server', command: 'node', args: ['/cli.js', 'server'] }], deps);
      const sigintListener = (deps.processOn as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === 'SIGINT')?.[1] as () => void;

      sigintListener();
      sigintListener();
      childProcess.emit('exit', null, 'SIGKILL');

      await expect(resultPromise).resolves.toBe(130);
      expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(childProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('preserves a non-zero child failure code when a parent signal follows', async () => {
      const failedProcess = new MockProcess();
      const siblingProcess = new MockProcess();
      const deps = buildDependencies([failedProcess, siblingProcess]);
      const resultPromise = spawnSupervisor(
        [
          { name: 'styles', command: 'node', args: ['/cli.js', 'styles'] },
          { name: 'server', command: 'node', args: ['/cli.js', 'server'] },
        ],
        deps
      );
      const sigtermListener = (deps.processOn as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === 'SIGTERM')?.[1] as () => void;

      failedProcess.emit('exit', 7, null);
      sigtermListener();
      siblingProcess.emit('exit', null, 'SIGTERM');

      await expect(resultPromise).resolves.toBe(7);
    });

    it('handles children without piped stdout or stderr streams', async () => {
      const childProcess = new MockProcess();
      const deps = buildDependencies([childProcess]);

      childProcess.stdout = null;
      childProcess.stderr = null;
      const resultPromise = spawnSupervisor([{ name: 'server', command: 'node', args: ['/cli.js', 'server'] }], deps);

      childProcess.emit('exit', 0, null);

      await expect(resultPromise).resolves.toBe(0);
    });
  });
});
