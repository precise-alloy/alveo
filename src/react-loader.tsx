import { lazy } from 'react';
import './scripts/functions.ts';
import { clientComponents } from 'virtual:alveo/client-components';

import { createComponentRenderer } from './react-loader-core.tsx';

const renderComponent = createComponentRenderer({
  root: lazy(() => import('./root/index.tsx')),
  ...clientComponents,
});

const renderComponents = async (): Promise<void> => {
  await Promise.all(Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-rct]'), renderComponent));
};

window.renderComponents = renderComponents;
void renderComponents();
window.addEventListener('load', () => {
  void renderComponents();
});

// This is an API-readiness event, not a React commit or YAML-completion event.
// Callers may safely invoke renderComponents while another batch is in flight.
window.dispatchEvent(new CustomEvent('react-loaded'));
