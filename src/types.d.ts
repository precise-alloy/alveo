// Ambient declarations for consumer project modules resolved via Vite aliases at build time.
// These types allow the alveo package to compile; actual implementations
// come from the consumer's project via alias configuration.

declare module '@helpers/RequireJs' {
  import { FC } from 'react';

  interface Props {
    path: string;
    async?: boolean;
    defer: boolean;
    type?: 'module' | 'text/javascript';
    inplace?: boolean;
  }

  const RequireJs: FC<Props>;
  export { RequireJs };
  export default RequireJs;
}

declare module '@helpers/ReactSection' {
  import { FC } from 'react';

  interface Model {
    type: string;
    data: unknown;
    css?: string | string[];
  }

  const ReactSection: FC<Model>;
  export default ReactSection;
}

// Consumer-provided modules resolved via Vite aliases at runtime.

declare module '@mocks/handlers' {
  import type { RequestHandler } from 'msw';

  export const handlers: RequestHandler[];
}

// Virtual modules provided by the alveo-virtual-modules Vite plugin.

declare module 'virtual:alveo/pages' {
  export const pages: Record<string, { [key: string]: any }>;
}

declare module 'virtual:alveo/svg-sprites' {
  export const sprites: Record<string, () => Promise<string>>;
}

declare module 'virtual:alveo/client-components' {
  import { LazyExoticComponent, ComponentType } from 'react';

  export const clientComponents: Record<string, LazyExoticComponent<ComponentType<any>>>;
}

// Global functions injected by alveo/scripts/functions.ts at runtime.

declare const viteAbsoluteUrl: (path: string, addExtension?: boolean) => string;
declare const getModifiers: (model: BasedAtomicModel, baseClass: string) => string;

interface BasedAtomicModel {
  globalModifier?: string[];
  styleModifier?: string[];
  theme?: string;
}

// Window extensions for the react-loader component hydration system.

interface Window {
  renderComponents: () => void;
  getCookie: (name: string) => string | undefined;
}

// Vite client types for import.meta.env and import.meta.glob.

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_BASE_URL: string;
  readonly VITE_PATH_EXTENSION: string;
  readonly VITE_TITLE_SUFFIX: string;
  readonly VITE_DOMAIN?: string;
  readonly VITE_PORT?: string;
  readonly VITE_TEST_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob: (pattern: string, options?: { eager?: boolean }) => Record<string, any>;
}
