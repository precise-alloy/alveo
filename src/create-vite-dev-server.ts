import { ViteDevServer, createServer } from 'vite';

interface Props {
  root: string;
  mode?: string;
  baseUrl?: string;
  isTest: boolean;
  hmrPort?: number;
}

const createViteDevServer = ({ root, mode = 'development', baseUrl, hmrPort, isTest }: Props): Promise<ViteDevServer> => {
  const server = createServer({
    root,
    mode,
    base: baseUrl,
    logLevel: isTest ? 'error' : 'info',
    server: {
      middlewareMode: true,
      watch: {
        // During tests we edit the files too fast and sometimes chokidar
        // misses change events, so enforce polling for consistency. Normal dev
        // watch should not pay the polling cost, so gate it behind isTest.
        usePolling: isTest,
        interval: 200,
      },
      // Vite 8 moved WebSocket transport configuration out of the deprecated
      // HMR options; retain the externally configured development socket port.
      ws: {
        port: hmrPort,
      },
    },
    appType: 'custom',
  });

  return server;
};

export { createViteDevServer };
