import fs from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';

import { normalizeTextLikeContent } from './text-normalization.ts';

export interface PackageBuildDependencies {
  rmSync: typeof fs.rmSync;
  mkdirSync: typeof fs.mkdirSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  globSync: (pattern: string, options: { nodir: boolean }) => string[];
}

const defaultDependencies: PackageBuildDependencies = { ...fs, globSync };

export function cleanPackageBuild(root: string, dependencies: Pick<PackageBuildDependencies, 'rmSync'> = defaultDependencies): void {
  dependencies.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
}

export function finalizePackageBuild(root: string, dependencies: PackageBuildDependencies = defaultDependencies): void {
  const dist = path.join(root, 'dist');

  dependencies.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  for (const file of ['types.d.ts', 'assets/root.svg', 'assets/pl-states.svg']) {
    const content = dependencies.readFileSync(path.join(root, 'src', file));

    dependencies.writeFileSync(path.join(dist, file), normalizeTextLikeContent(file, content));
  }

  // tsc embeds checkout source text in maps. Normalize after every producer has
  // finished, including escaped sourcesContent, without changing binary bytes.
  for (const file of dependencies.globSync(path.join(dist, '**/*').replaceAll('\\', '/'), { nodir: true })) {
    const content = normalizeTextLikeContent(file, dependencies.readFileSync(file));

    if (typeof content === 'string') dependencies.writeFileSync(file, content);
  }
}

/* v8 ignore next 4 -- CLI dispatch is exercised by the packed-package test */
if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, '..');

  (process.argv.includes('--clean') ? cleanPackageBuild : finalizePackageBuild)(root);
}
