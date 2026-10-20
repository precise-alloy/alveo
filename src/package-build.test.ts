// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { cleanPackageBuild, finalizePackageBuild, type PackageBuildDependencies } from './package-build.ts';

describe('package output preparation', () => {
  it('only cleans the dist directory', () => {
    const rmSync = vi.fn();

    cleanPackageBuild('/project', { rmSync });
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(path.join('/project', 'dist'), { recursive: true, force: true });
  });

  it('copies declarations and framework assets, normalizes text maps, and leaves binary output alone', () => {
    const writeFileSync = vi.fn();
    const dependencies: PackageBuildDependencies = {
      rmSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync,
      readFileSync: vi
        .fn()
        .mockReturnValueOnce(Buffer.from('declare const x: string;\r\n'))
        .mockReturnValueOnce(Buffer.from('<svg>\r\n</svg>'))
        .mockReturnValueOnce(Buffer.from('<svg/>'))
        .mockReturnValueOnce(Buffer.from('{"sourcesContent":["a\\r\\nb"]}\r\n'))
        .mockReturnValueOnce(Buffer.from([0, 255, 13, 10])),
      globSync: vi.fn().mockReturnValue(['/project/dist/a.js.map', '/project/dist/image.png']),
    };

    finalizePackageBuild('/project', dependencies);
    expect(writeFileSync).toHaveBeenCalledWith(path.join('/project', 'dist/types.d.ts'), 'declare const x: string;\n');
    expect(writeFileSync).toHaveBeenCalledWith('/project/dist/a.js.map', '{"sourcesContent":["a\\nb"]}');
    expect(writeFileSync).not.toHaveBeenCalledWith('/project/dist/image.png', expect.anything());
  });

  it('works with actual files after a stale output has been removed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-output-'));

    try {
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist/stale.js'), 'stale');
      cleanPackageBuild(root);
      expect(fs.existsSync(path.join(root, 'dist/stale.js'))).toBe(false);
      fs.mkdirSync(path.join(root, 'src/assets'), { recursive: true });
      for (const file of ['types.d.ts', 'assets/root.svg', 'assets/pl-states.svg']) {
        fs.writeFileSync(path.join(root, 'src', file), 'content\r\n');
      }
      finalizePackageBuild(root);
      expect(fs.readFileSync(path.join(root, 'dist/assets/root.svg'), 'utf8')).toBe('content\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
