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

export const getFunctionsFallbackSourcePath = (): string => {
  return slash(path.resolve(getPackageRoot(), 'src/scripts/functions.ts'));
};

export const resolveFunctionsSourcePath = (
  sourcePath = getFunctionsSourcePath(),
  existsSync: (targetPath: string) => boolean = fs.existsSync
): string => {
  // Fresh source checkouts have no dist build; only the default path falls back to source.
  if (sourcePath === getFunctionsSourcePath() && !existsSync(sourcePath)) {
    return getFunctionsFallbackSourcePath();
  }

  return sourcePath;
};

export type InjectFunctionsDependencies = {
  readFileSync: typeof fs.readFileSync;
};

export const defaultInjectFunctionsDependencies: InjectFunctionsDependencies = {
  readFileSync: ((targetPath: fs.PathOrFileDescriptor, options: BufferEncoding) => {
    const resolvedPath = typeof targetPath === 'string' ? resolveFunctionsSourcePath(targetPath) : targetPath;

    return fs.readFileSync(resolvedPath, options);
  }) as typeof fs.readFileSync,
};

export const containsFunctionsPlaceholder = (code: string): boolean => code.includes(FUNCTIONS_PLACEHOLDER);

export const loadFunctionsSource = (sourcePath?: string, dependencies: InjectFunctionsDependencies = defaultInjectFunctionsDependencies): string =>
  dependencies.readFileSync(sourcePath ?? getFunctionsSourcePath(), 'utf8') as string;
