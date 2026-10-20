import { loadEnv } from 'vite';

import { assertDevelopmentMode, startServer } from './create-server.ts';
import { parsePort } from './dev-supervisor.ts';

export async function initServer(projectRoot: string, { mode = 'development', port: rawPort }: { mode?: string; port?: string } = {}) {
  assertDevelopmentMode(mode);
  const env = loadEnv(mode, projectRoot);
  const isTest = !!env.VITE_TEST_BUILD || process.env.NODE_ENV === 'test';
  const port = parsePort(rawPort ?? env.VITE_PORT ?? '5000');

  if (!isTest) {
    return startServer({
      root: projectRoot,
      mode,
      isTest,
      port,
      hmrPort: port < 65535 ? port + 1 : undefined,
      baseUrl: env.VITE_BASE_URL,
    });
  }
}
