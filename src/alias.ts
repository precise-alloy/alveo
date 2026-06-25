import path from 'path';

import slash from 'slash';

type AliasEntry = {
  find: string;
  replacement: string;
};

/**
 * Creates Vite alias mappings resolved relative to the consumer's project root.
 *
 * @param projectRoot - Absolute path to the consumer project's root directory
 */
export function createAliases(projectRoot: string): AliasEntry[] {
  const srcRoot = slash(path.resolve(projectRoot, 'src'));

  return [
    { find: '@atoms', replacement: slash(path.resolve(srcRoot, 'atoms')) },
    { find: '@molecules', replacement: slash(path.resolve(srcRoot, 'molecules')) },
    { find: '@organisms', replacement: slash(path.resolve(srcRoot, 'organisms')) },
    { find: '@templates', replacement: slash(path.resolve(srcRoot, 'templates')) },
    { find: '@pages', replacement: slash(path.resolve(srcRoot, 'pages')) },
    { find: '@assets', replacement: slash(path.resolve(srcRoot, 'assets')) },
    { find: '@helpers', replacement: slash(path.resolve(srcRoot, '_helpers')) },
    { find: '@data', replacement: slash(path.resolve(srcRoot, '_data')) },
    { find: '@_http', replacement: slash(path.resolve(srcRoot, '_http')) },
    { find: '@_api', replacement: slash(path.resolve(srcRoot, '_api')) },
    { find: '@mocks', replacement: slash(path.resolve(srcRoot, 'mocks')) },
  ];
}
