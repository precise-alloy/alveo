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

// Opt-in globals must merge cleanly with starter/consumer declarations under
// skipLibCheck: false. Projects own `BasedAtomicModel` (the starter declares
// it as a type alias, which cannot merge with an interface), so the helper
// takes a structural inline type instead of declaring that global name here.
declare const viteAbsoluteUrl: (path: string, addExtension?: boolean) => string;
declare const getModifiers: (model: { globalModifier?: string[]; styleModifier?: string[]; theme?: string }, baseClass: string) => string;

interface Window {
  renderComponents: () => Promise<void>;
  getCookie: (name: string) => string | undefined;
}

// ImportMetaEnv is intentionally not augmented: vite/client already types
// every key, and merged interface properties must match exactly, so any
// project declaring e.g. `VITE_PORT: number` would fail to compile.
