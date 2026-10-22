// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateDestinations, validateExpectedFiles, type DestinationDependencies } from './integration-core.ts';

const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-destinations-'));

  roots.push(root);
  const project = path.join(root, 'project');

  fs.mkdirSync(path.join(project, 'src'), { recursive: true });

  return { root, project };
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('integration destination safety', () => {
  it.each(['src', 'public', '.git', '..generated'])('rejects project descendants including %s', (destination) => {
    const { root, project } = fixture();

    expect(validateDestinations(path.join(root, 'out'), destination, project)).toMatchObject({ ok: false });
    expect(validateDestinations(destination, undefined, project).reasons).toContain('VITE_INTE_ASSET_DIR is inside project root');
  });

  it('rejects equal and nested destinations in either direction and accepts distinct siblings', () => {
    const { root, project } = fixture();
    const out = path.join(root, 'output');

    for (const [assets, patterns] of [
      [out, out],
      [out, path.join(out, 'patterns')],
      [path.join(out, 'assets'), out],
    ]) {
      expect(validateDestinations(assets!, patterns, project).reasons).toContain('Integration destinations must not overlap each other');
    }
    expect(validateDestinations(out, out + '-patterns', project)).toEqual({ ok: true, reasons: [] });
    expect(validateDestinations(out, '', project).ok).toBe(false);
  });

  it('rejects external symlinks into the project and destination aliases', () => {
    const { root, project } = fixture();
    const escape = path.join(root, 'escape');

    fs.symlinkSync(path.join(project, 'src'), escape, 'junction');
    expect(validateDestinations(escape, undefined, project).ok).toBe(false);
    const target = path.join(root, 'output');

    fs.mkdirSync(target);
    const alias = path.join(root, 'alias');

    fs.symlinkSync(target, alias, 'junction');
    expect(validateDestinations(target, alias, project).reasons).toContain('Integration destinations must not overlap each other');
    expect(validateDestinations(alias, path.join(target, 'child'), project).ok).toBe(false);
    expect(validateDestinations(path.join(target, 'child'), alias, project).ok).toBe(false);
  });

  it('rejects in-project symlinks even when their target is external', () => {
    const { root, project } = fixture();
    const target = path.join(root, 'output');

    fs.mkdirSync(target);
    const link = path.join(project, 'output');

    fs.symlinkSync(target, link, 'junction');
    expect(validateDestinations(link, undefined, project).ok).toBe(false);
  });

  it('reports filesystem errors, file destinations, and unresolved roots explicitly', () => {
    const { root, project } = fixture();
    const file = path.join(root, 'file');

    fs.writeFileSync(file, 'keep');
    expect(validateDestinations(file, undefined, project).reasons.join()).toContain('not a directory');
    const missing: DestinationDependencies = { lstat: () => undefined, realpath: (value) => value };

    expect(validateDestinations('/out', undefined, '/project', missing).reasons.join()).toContain('filesystem root');
    const unreadable: DestinationDependencies = {
      lstat: () => {
        throw new Error('permission denied');
      },
      realpath: (value) => value,
    };

    expect(validateDestinations('/out', undefined, '/project', unreadable).reasons.join()).toContain('permission denied');
    const changedLink: DestinationDependencies = {
      lstat: vi
        .fn()
        .mockReturnValueOnce({ isDirectory: () => false, isSymbolicLink: () => true })
        .mockReturnValue(undefined),
      realpath: () => '/gone',
    };

    expect(validateDestinations('/out', undefined, '/project', changedLink).ok).toBe(false);
  });

  it('does not mutate reusable global/sticky expected-file regexes', () => {
    const expression = /react-loader\.0xabcdefgh\.js/gy;

    expression.lastIndex = 9;
    const dependencies = { existsSync: () => true, readdirSync: () => ['react-loader.0xabcdefgh.js'], log: vi.fn(), warn: (text: string) => text };

    for (let run = 0; run < 2; run++) {
      expect(validateExpectedFiles([{ fileName: expression }], '/out', dependencies).isValid).toBe(true);
    }
    expect(expression.lastIndex).toBe(9);
  });
});
