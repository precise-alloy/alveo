import fs from 'fs';
import path from 'path';

import slash from 'slash';

import { getPackageRoot } from '../paths.ts';

export const FUNCTIONS_PLACEHOLDER = '/* DO NOT REMOVE - AUTO-IMPORTS FUNCTIONS PLACEHOLDER */';
export const VIRTUAL_FUNCTIONS_ID = 'virtual:alveo/functions';
export const RESOLVED_VIRTUAL_FUNCTIONS_ID = '\0' + VIRTUAL_FUNCTIONS_ID + '.ts';
export const FUNCTIONS_IMPORT_STATEMENT = `import '${VIRTUAL_FUNCTIONS_ID}';`;

export const getFunctionsSourcePath = (): string => {
  return slash(path.resolve(getPackageRoot(), 'dist/scripts/functions.js'));
};

export type InjectFunctionsDependencies = {
  readFileSync: typeof fs.readFileSync;
};

export const defaultInjectFunctionsDependencies: InjectFunctionsDependencies = {
  readFileSync: ((targetPath: fs.PathOrFileDescriptor, options: BufferEncoding) => {
    if (typeof targetPath === 'string' && !fs.existsSync(targetPath)) {
      return fs.readFileSync(slash(path.resolve(getPackageRoot(), 'src/scripts/functions.ts')), options);
    }

    return fs.readFileSync(targetPath, options);
  }) as typeof fs.readFileSync,
};

export const containsFunctionsPlaceholder = (code: string): boolean => code.includes(FUNCTIONS_PLACEHOLDER);

export const loadFunctionsSource = (sourcePath?: string, dependencies: InjectFunctionsDependencies = defaultInjectFunctionsDependencies): string =>
  dependencies.readFileSync(sourcePath ?? getFunctionsSourcePath(), 'utf8') as string;
