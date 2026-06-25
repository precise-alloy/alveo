import fs from 'fs';
import path from 'path';

import slash from 'slash';

import { getPackageRoot } from '../paths.js';

export const FUNCTIONS_PLACEHOLDER = '/* DO NOT REMOVE - AUTO-IMPORTS FUNCTIONS PLACEHOLDER */';

export const getFunctionsSourcePath = (): string => {
  return slash(path.resolve(getPackageRoot(), 'dist/scripts/functions.js'));
};

export type InjectFunctionsDependencies = {
  readFileSync: typeof fs.readFileSync;
};

export const defaultInjectFunctionsDependencies: InjectFunctionsDependencies = {
  readFileSync: fs.readFileSync,
};

export const containsFunctionsPlaceholder = (code: string): boolean => code.includes(FUNCTIONS_PLACEHOLDER);

export const loadFunctionsSource = (sourcePath?: string, dependencies: InjectFunctionsDependencies = defaultInjectFunctionsDependencies): string =>
  dependencies.readFileSync(sourcePath ?? getFunctionsSourcePath(), 'utf8') as string;
