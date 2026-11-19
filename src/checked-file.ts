import fs from 'node:fs';

type FileIdentity = Pick<fs.BigIntStats, 'dev' | 'ino' | 'nlink'>;

/** Open without creating or truncating; run I/O only on the inspected file. */
export function withCheckedFile<T>(file: string, expected: FileIdentity, access: 'read' | 'update', operation: (fd: number) => T): T {
  const { O_RDONLY, O_RDWR, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  // Where no-follow/nonblocking flags are unavailable, the descriptor identity
  // check still applies. Never request truncation before that check.
  const fd = fs.openSync(file, (access === 'read' ? O_RDONLY : O_RDWR) | O_NOFOLLOW | O_NONBLOCK);

  try {
    const opened = fs.fstatSync(fd, { bigint: true });

    if (opened.dev !== expected.dev || opened.ino !== expected.ino || opened.nlink !== expected.nlink) {
      throw new Error(`File identity or link count changed: ${file}`);
    }

    return operation(fd);
  } finally {
    fs.closeSync(fd);
  }
}
