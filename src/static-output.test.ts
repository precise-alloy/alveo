// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeStaticOutput } from './static-output.ts';

describe('static output normalization boundaries', () => {
  let root: string;
  let out: string;
  let external: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-output-'));
    out = path.join(root, 'dist');
    external = path.join(root, 'outside');
    fs.mkdirSync(out);
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'keep.js'), 'keep\r\n');
  });
  afterEach(() => fs.rmSync(root, { force: true, recursive: true }));

  it('only rewrites inventoried regular text files, never linked files or binary data', () => {
    fs.symlinkSync(external, path.join(out, 'linked-dir'), 'junction');
    fs.writeFileSync(path.join(external, 'shared.js'), 'shared\r\n');
    fs.linkSync(path.join(external, 'shared.js'), path.join(out, 'hard.js'));
    fs.mkdirSync(path.join(out, 'directory.js'));
    fs.writeFileSync(path.join(out, 'generated.js'), 'owned\r\n');
    const opaque = Buffer.from([255, 13, 10]);

    fs.writeFileSync(path.join(out, 'opaque.js'), opaque);
    const binary = Buffer.from([65, 0, 13, 10]);

    fs.writeFileSync(path.join(out, 'binary.js'), binary);

    normalizeStaticOutput(
      out,
      ['generated.js', 'linked-dir/keep.js', 'hard.js', '../outside/keep.js', 'directory.js', 'missing.js', 'opaque.js', 'binary.js'],
      false
    );
    expect(fs.readFileSync(path.join(out, 'generated.js'), 'utf8')).toBe('owned\n');
    expect(fs.readFileSync(path.join(external, 'keep.js'), 'utf8')).toBe('keep\r\n');
    expect(fs.readFileSync(path.join(external, 'shared.js'), 'utf8')).toBe('shared\r\n');
    expect(fs.readFileSync(path.join(out, 'opaque.js'))).toEqual(opaque);
    expect(fs.readFileSync(path.join(out, 'binary.js'))).toEqual(binary);
  });

  it('does not traverse linked output roots or normalize overlapping input/output directories', () => {
    const alias = path.join(root, 'alias');

    fs.symlinkSync(external, alias, 'junction');
    for (const [dir, publicDir] of [
      [alias, false],
      [external, external],
      [external, root],
      [root, external],
    ] as const) {
      normalizeStaticOutput(dir, ['keep.js', 'outside/keep.js'], publicDir);
    }
    expect(fs.readFileSync(path.join(external, 'keep.js'), 'utf8')).toBe('keep\r\n');
    normalizeStaticOutput(external, ['keep.js'], path.join(root, 'missing-public'));
    expect(fs.readFileSync(path.join(external, 'keep.js'), 'utf8')).toBe('keep\n');
  });
});
