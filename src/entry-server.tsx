import ReactDOMServer from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';

import './scripts/functions.ts';
import { routesToPrerender } from './routes.ts';
import { App } from './app.tsx';

export interface RenderOutput {
  html: string;
  styles: string;
}

// Carry the resolved Vite base into prerendering. Re-reading only .env would
// ignore defineAlveoConfig({ base }) and render a different router location.
export const renderConfig = {
  baseUrl: import.meta.env.BASE_URL,
  pathExtension: import.meta.env.VITE_PATH_EXTENSION ?? '',
  domain: import.meta.env.VITE_DOMAIN,
};

export function render(url: string): RenderOutput {
  try {
    const html = ReactDOMServer.renderToString(
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    );

    return { html, styles: '' };
  } catch (cause) {
    // Empty HTML can be a legitimate component result, but an exception cannot
    // be turned into a successful empty render or followed by integration copy.
    throw new Error(`SSR failed for route "${url}".`, { cause });
  }
}

export { routesToPrerender };
