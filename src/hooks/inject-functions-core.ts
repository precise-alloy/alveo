import fs from 'fs';
import path from 'path';

import slash from 'slash';

import { getPackageRoot } from '../paths.js';

export const FUNCTIONS_PLACEHOLDER = '/* DO NOT REMOVE - AUTO-IMPORTS FUNCTIONS PLACEHOLDER */';

/**
 * Returns the absolute path to alveo's own `scripts/functions.ts`.
 * Resolves relative to the alveo package root, not the consumer project.
 */
export const getFunctionsSourcePath = (): string => slash(path.resolve(getPackageRoot(), 'src/scripts/functions.ts'));

export type InjectFunctionsDependencies = {
  readFileSync: typeof fs.readFileSync;
};

export const defaultInjectFunctionsDependencies: InjectFunctionsDependencies = {
  readFileSync: fs.readFileSync,
};

export const containsFunctionsPlaceholder = (code: string): boolean => code.includes(FUNCTIONS_PLACEHOLDER);

export const loadFunctionsSource = (sourcePath?: string, dependencies: InjectFunctionsDependencies = defaultInjectFunctionsDependencies): string =>
  dependencies.readFileSync(sourcePath ?? getFunctionsSourcePath(), 'utf8') as string;
