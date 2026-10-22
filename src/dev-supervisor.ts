import type { SpawnOptions } from 'child_process';

import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { StringDecoder } from 'node:string_decoder';

import chalk from 'chalk';
import slash from 'slash';

import { getPackageRoot } from './paths.ts';

const require = createRequire(import.meta.url);

export interface DevProcessSpec {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  prefixColor?: 'blue' | 'green' | 'yellow' | 'magenta';
}

export interface BuildDevProcessesOptions {
  projectRoot: string;
  mode: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  nodeCommand?: string;
  alveoCliPath?: string;
  viteCliPath?: string;
}

export interface SpawnedDevProcess {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  killed?: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
  on(eventName: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): SpawnedDevProcess;
  on(eventName: 'error', listener: (error: Error) => void): SpawnedDevProcess;
}

export interface DevSupervisorDependencies {
  spawnProcess: (command: string, args: string[], options: SpawnOptions) => SpawnedDevProcess;
  stdoutWrite: (value: string) => void;
  stderrWrite: (value: string) => void;
  processOn: (signal: NodeJS.Signals, listener: () => void) => void;
  processOff: (signal: NodeJS.Signals, listener: () => void) => void;
}

const defaultDevSupervisorDependencies: DevSupervisorDependencies = {
  spawnProcess: spawn,
  stdoutWrite: process.stdout.write.bind(process.stdout),
  stderrWrite: process.stderr.write.bind(process.stderr),
  processOn: process.on.bind(process),
  processOff: process.off.bind(process),
};

export const parsePort = (raw: string): number => {
  if (!/^\d+$/.test(raw)) {
    throw new Error('--port must be an integer between 1 and 65535');
  }

  const port = Number(raw);

  if (port < 1 || port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }

  return port;
};

export const assertMode = (raw: string): string => {
  if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
    throw new Error('--mode may only contain letters, numbers, dots, underscores, and hyphens');
  }

  return raw;
};

export const resolveAlveoCliPath = (packageRoot = getPackageRoot()): string => slash(path.resolve(packageRoot, 'bin/cli.js'));

export const resolveViteCliPath = (): string => {
  // Dev uses alveo's declared Vite dependency instead of a consumer-local npx
  // shim so process launch stays deterministic and shell-free on every OS.
  const packageJsonPath = require.resolve('vite/package.json');
  const vitePackage = require('vite/package.json') as { bin: { vite: string } };

  return path.resolve(path.dirname(packageJsonPath), vitePackage.bin.vite);
};

const getSignalExitCode = (signal: NodeJS.Signals): number => {
  return signal === 'SIGINT' ? 130 : 143;
};

export const buildDevProcesses = ({
  projectRoot,
  mode,
  port,
  env = process.env,
  nodeCommand = process.execPath,
  alveoCliPath = resolveAlveoCliPath(),
  viteCliPath = resolveViteCliPath(),
}: BuildDevProcessesOptions): DevProcessSpec[] => {
  const serverArgs = [alveoCliPath, 'server', '--mode', mode];

  if (port !== undefined) {
    serverArgs.push('--port', String(port));
  }

  serverArgs.push('--root', projectRoot);

  return [
    {
      command: nodeCommand,
      args: [alveoCliPath, 'styles', '--watch', '--root', projectRoot],
      name: 'styles',
      prefixColor: 'blue',
    },
    {
      command: nodeCommand,
      args: [alveoCliPath, 'states', '--watch', '--root', projectRoot],
      name: 'states',
      prefixColor: 'green',
    },
    {
      command: nodeCommand,
      args: [viteCliPath, 'build', '--mode', mode, '--watch'],
      cwd: projectRoot,
      env: { ...env, scriptOnly: 'true' },
      name: 'vite',
      prefixColor: 'yellow',
    },
    {
      command: nodeCommand,
      args: serverArgs,
      name: 'server',
      prefixColor: 'magenta',
    },
  ];
};

export const colorizePrefix = (prefix: string, prefixColor?: DevProcessSpec['prefixColor']): string => {
  if (prefixColor === 'blue') return chalk.blue(prefix);
  if (prefixColor === 'green') return chalk.green(prefix);
  if (prefixColor === 'yellow') return chalk.yellow(prefix);
  if (prefixColor === 'magenta') return chalk.magenta(prefix);

  return prefix;
};

export const formatProcessOutput = (name: string, prefixColor: DevProcessSpec['prefixColor'], chunk: Buffer | string): string => {
  const prefix = colorizePrefix(`[${name}]`, prefixColor);
  const text = chunk.toString();

  if (!text) {
    return '';
  }

  const lines = text.split(/\r\n|\r|\n/);
  const hasTrailingLineEnding = text.endsWith('\n') || text.endsWith('\r');
  const visibleLines = hasTrailingLineEnding ? lines.slice(0, -1) : lines;

  return visibleLines.map((line) => `${prefix} ${line}\n`).join('');
};

export const createProcessOutputFormatter = (name: string, color: DevProcessSpec['prefixColor']) => {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const drain = (final: boolean): string => {
    let output = '';
    let index = pending.search(/[\r\n]/);

    while (index >= 0) {
      // Keep a trailing CR until its possible LF arrives in the next chunk.
      if (!final && pending[index] === '\r' && index === pending.length - 1) break;
      const end = index + (pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1);

      output += formatProcessOutput(name, color, pending.slice(0, end));
      pending = pending.slice(end);
      index = pending.search(/[\r\n]/);
    }
    if (final && pending) {
      output += formatProcessOutput(name, color, pending);
      pending = '';
    }

    return output;
  };

  return {
    write(chunk: Buffer | string) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);

      return drain(false);
    },
    end() {
      pending += decoder.end();

      return drain(true);
    },
  };
};

export const spawnSupervisor = (
  specs: DevProcessSpec[],
  dependencies: DevSupervisorDependencies = defaultDevSupervisorDependencies
): Promise<number> => {
  if (specs.length === 0) {
    return Promise.resolve(0);
  }

  return new Promise((resolve) => {
    const activeProcesses = new Set<SpawnedDevProcess>();
    let exitCode = 0;
    let resolved = false;
    let signalRequested = false;
    const terminateProcesses = (failedProcess?: SpawnedDevProcess, signal: NodeJS.Signals = 'SIGTERM', force = false): void => {
      activeProcesses.forEach((activeProcess) => {
        if (activeProcess !== failedProcess && (force || !activeProcess.killed)) {
          activeProcess.kill(signal);
        }
      });
    };
    const signalHandlers = (['SIGINT', 'SIGTERM'] as NodeJS.Signals[]).map((signal) => {
      const listener = (): void => {
        if (signalRequested) {
          terminateProcesses(undefined, 'SIGKILL', true);

          return;
        }

        signalRequested = true;

        if (exitCode === 0) {
          exitCode = getSignalExitCode(signal);
        }

        terminateProcesses();
        resolveWhenDone();
      };

      dependencies.processOn(signal, listener);

      return { signal, listener };
    });
    const cleanupSignalHandlers = (): void => {
      signalHandlers.forEach(({ signal, listener }) => dependencies.processOff(signal, listener));
    };
    const resolveWhenDone = (): void => {
      if (!resolved && activeProcesses.size === 0) {
        resolved = true;
        cleanupSignalHandlers();
        resolve(exitCode);
      }
    };
    const recordExit = (spec: DevProcessSpec, processRef: SpawnedDevProcess, code: number): void => {
      if (!activeProcesses.has(processRef)) {
        return;
      }

      activeProcesses.delete(processRef);
      dependencies.stderrWrite(formatProcessOutput(spec.name, spec.prefixColor, `exited with code ${code}`));

      if (code !== 0 && exitCode === 0) {
        exitCode = code;
        terminateProcesses(processRef);
      } else if (code === 0 && activeProcesses.size > 0 && !signalRequested && exitCode === 0) {
        exitCode = 1;
        terminateProcesses(processRef);
      }

      resolveWhenDone();
    };

    try {
      specs.forEach((spec) => {
        const childProcess = dependencies.spawnProcess(spec.command, spec.args, {
          cwd: spec.cwd,
          env: spec.env,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        activeProcesses.add(childProcess);
        const forward = (stream: NodeJS.ReadableStream | null | undefined, write: (value: string) => void) => {
          const formatter = createProcessOutputFormatter(spec.name, spec.prefixColor);
          const flush = () => {
            const text = formatter.end();

            if (text) write(text);
          };

          stream?.on('data', (chunk) => {
            const text = formatter.write(chunk);

            if (text) write(text);
          });
          stream?.on('end', flush);

          return flush;
        };
        const flushOut = forward(childProcess.stdout, dependencies.stdoutWrite);
        const flushError = forward(childProcess.stderr, dependencies.stderrWrite);

        childProcess.on('error', (error) => {
          dependencies.stderrWrite(formatProcessOutput(spec.name, spec.prefixColor, String(error)));
          recordExit(spec, childProcess, 1);
        });
        // close follows stdio completion; exit can precede the final UTF-8 bytes.
        childProcess.on('close', (code, signal) => {
          flushOut();
          flushError();
          recordExit(spec, childProcess, code ?? (signal ? 1 : 0));
        });
      });
    } catch (error) {
      dependencies.stderrWrite(formatProcessOutput('dev', undefined, error instanceof Error ? error.message : String(error)));
      exitCode = 1;
      terminateProcesses();
      resolveWhenDone();
    }
  });
};
