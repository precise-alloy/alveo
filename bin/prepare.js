import { chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const hooks = path.join(root, '.git-hooks');

// Packed and Git-dependency installations are not maintainer checkouts. Never
// change a parent application's Git configuration or hide a real setup failure.
if (existsSync(path.join(root, '.git')) && existsSync(hooks)) {
  const result = spawnSync('git', ['-C', root, 'config', '--local', 'core.hooksPath', '.git-hooks'], { stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Unable to install Alveo Git hooks.');

  for (const name of ['pre-commit', 'pre-push']) {
    chmodSync(path.join(hooks, name), 0o755);
  }
}
