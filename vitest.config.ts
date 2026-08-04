import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: [
        'src/alias.ts',
        'src/asset-hash.ts',
        'src/cryptography.ts',
        'src/dev-supervisor.ts',
        'src/filename.ts',
        'src/hooks/inject-functions.ts',
        'src/hooks/inject-functions-core.ts',
        'src/integration-core.ts',
        'src/manual-chunk.ts',
        'src/precompile-styles.ts',
        'src/prerender-core.ts',
        'src/scripts-core.ts',
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
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/types.d.ts', 'src/scripts/*.entry.ts', 'src/styles/**', 'src/root/**'],
    },
  },
});
