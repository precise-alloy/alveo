// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { withCheckedFile } from './checked-file.ts';

it('refuses stale identities without invoking the updater or truncating the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-checked-'));
  const file = path.join(dir, 'output.js');

  try {
    fs.writeFileSync(file, 'original');
    const stat = fs.lstatSync(file, { bigint: true });
    const update = vi.fn();

    for (const key of ['dev', 'ino', 'nlink'] as const) {
      expect(() => withCheckedFile(file, { ...stat, [key]: stat[key] + 1n }, 'update', update)).toThrow(/identity or link count changed/);
    }
    expect(update).not.toHaveBeenCalled();
    expect(withCheckedFile(file, stat, 'read', (fd) => fs.readFileSync(fd, 'utf8'))).toBe('original');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
