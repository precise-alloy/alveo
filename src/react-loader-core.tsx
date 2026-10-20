import type { ClientComponents } from './client-components.ts';

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export interface ReactLoaderDependencies {
  createRoot: typeof createRoot;
  loadYaml: () => Promise<Pick<typeof import('js-yaml'), 'load'>>;
  reportError: (component: string, error: unknown) => void;
}

export const defaultReactLoaderDependencies: ReactLoaderDependencies = {
  createRoot,
  loadYaml: () => import('js-yaml'),
  reportError: (component, error) => console.error(`[alveo] Component "${component}" failed:`, error),
};

function createComponentContainer(script: HTMLScriptElement): HTMLElement {
  const requestedTag = (script.getAttribute('data-tag') ?? '').trim().toLowerCase();
  const section = document.createElement(['div', 'section'].includes(requestedTag) ? requestedTag : 'section');

  section.className = script.getAttribute('data-class') ?? '';

  return section;
}

export function createComponentRenderer(components: ClientComponents, dependencies = defaultReactLoaderDependencies) {
  const pending = new WeakSet<HTMLScriptElement>();

  return async (script: HTMLScriptElement): Promise<void> => {
    if (!script.isConnected || pending.has(script)) return;
    pending.add(script);
    const name = script.getAttribute('data-rct') ?? '';
    let root: Root | undefined;

    try {
      const Component = Object.hasOwn(components, name) ? components[name] : undefined;

      if (!Component) throw new Error(`Unknown component: ${name}`);
      const data = script.textContent || '{}';
      const type = script.getAttribute('type') ?? 'application/json';
      let props: unknown;

      if (type === 'application/json') props = JSON.parse(data);
      else if (type === 'application/yaml') props = (await dependencies.loadYaml()).load(data);
      else throw new Error(`Unsupported component payload type: ${type}`);
      if (props !== null && typeof props !== 'object') throw new TypeError('Component props must be an object or null.');

      // A second load event or manual render call can overlap a YAML import.
      // Keep the payload intact until parsing/mount scheduling succeeds, and
      // do not resurrect content removed while the parser was loading.
      if (!script.isConnected) return;
      const section = createComponentContainer(script);

      root = dependencies.createRoot(section, {
        onUncaughtError: (error) => dependencies.reportError(name, error),
      });
      root.render(createElement(Component, props));
      script.replaceWith(section);
    } catch (error) {
      root?.unmount();
      dependencies.reportError(name, error);
    } finally {
      pending.delete(script);
    }
  };
}
