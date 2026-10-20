import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const clientComponentsFixture = fileURLToPath(new URL('./test/client-components.ts', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    alias: {
      // Consumer projects supply this virtual module; tests use an empty fixture
      // so loader behavior can run without project-specific Vite configuration.
      'virtual:alveo/client-components': clientComponentsFixture,
      'virtual:alveo/svg-sprites': fileURLToPath(new URL('./test/svg-sprites.ts', import.meta.url)),
      'virtual:alveo/pages': fileURLToPath(new URL('./test/pages.ts', import.meta.url)),
    },
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: [
        'src/alias.ts',
        'src/asset-hash.ts',
        'src/cryptography.ts',
        'src/config.ts',
        'src/create-server.ts',
        'src/create-vite-dev-server.ts',
        'src/dev-supervisor.ts',
        'src/entry-server.tsx',
        'src/filename.ts',
        'src/helpers.tsx',
        'src/hooks/inject-functions.ts',
        'src/hooks/inject-functions-core.ts',
        'src/hooks/options.ts',
        'src/hooks/transform.ts',
        'src/hooks/transform-index-html.ts',
        'src/integration-core.ts',
        'src/manual-chunk.ts',
        'src/package-build.ts',
        'src/precompile-styles.ts',
        'src/prerender-core.ts',
        'src/react-loader-core.tsx',
        'src/renderer.ts',
        'src/root/catalog.ts',
        'src/root/active-item-options.tsx',
        'src/root/frame-controls.tsx',
        'src/root/svg-symbols.ts',
        'src/scripts-core.ts',
        'src/scaffold.ts',
        'src/server.ts',
        'src/scripts/state-markup.ts',
        'src/scripts/functions.ts',
        'src/states-core.ts',
        'src/styles-core.ts',
        'src/text-normalization.ts',
        'src/virtual-modules.ts',
      ],
      thresholds: {
        perFile: true,
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 95,
      },
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/types.d.ts', 'src/scripts/*.entry.ts', 'src/styles/**'],
    },
  },
});
