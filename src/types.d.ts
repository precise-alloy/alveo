/// <reference types="vite/client" />

// Opt in through tsconfig's types: ["alveo/types"] in consumer projects.
// This file is copied explicitly because tsc does not emit input declarations.
declare module '@mocks/handlers' {
  import type { RequestHandler } from 'msw';

  export const handlers: RequestHandler[];
}

declare module 'virtual:alveo/pages' {
  export const pages: Record<string, { [key: string]: any }>;
}

declare module 'virtual:alveo/svg-sprites' {
  export const sprites: Record<string, () => Promise<string>>;
}

declare module 'virtual:alveo/client-components' {
  export const clientComponents: import('./client-components.ts').ClientComponents;
}

declare const viteAbsoluteUrl: (path: string, addExtension?: boolean) => string;
declare const getModifiers: (model: BasedAtomicModel, baseClass: string) => string;

interface BasedAtomicModel {
  globalModifier?: string[];
  styleModifier?: string[];
  theme?: string;
}

interface Window {
  renderComponents: () => Promise<void>;
  getCookie: (name: string) => string | undefined;
}

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_PATH_EXTENSION: string;
  readonly VITE_TITLE_SUFFIX: string;
  readonly VITE_DOMAIN?: string;
  readonly VITE_PORT?: string;
  readonly VITE_TEST_BUILD?: string;
}
