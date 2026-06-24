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
        'src/asset-hash.ts',
        'src/filename.ts',
        'src/hooks/inject-functions.ts',
        'src/hooks/inject-functions-core.ts',
        'src/integration-core.ts',
        'src/manual-chunk.ts',
        'src/prerender-core.ts',
        'src/scripts-core.ts',
        'src/styles-core.ts',
      ],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/types.d.ts', 'src/scripts/*.entry.ts', 'src/styles/**', 'src/root/**'],
    },
  },
});
