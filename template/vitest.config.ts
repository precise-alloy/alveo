import path from 'path';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const srcRoot = path.resolve(import.meta.dirname, 'src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@atoms', replacement: path.resolve(srcRoot, 'atoms') },
      { find: '@molecules', replacement: path.resolve(srcRoot, 'molecules') },
      { find: '@organisms', replacement: path.resolve(srcRoot, 'organisms') },
      { find: '@templates', replacement: path.resolve(srcRoot, 'templates') },
      { find: '@pages', replacement: path.resolve(srcRoot, 'pages') },
      { find: '@assets', replacement: path.resolve(srcRoot, 'assets') },
      { find: '@helpers', replacement: path.resolve(srcRoot, '_helpers') },
      { find: '@data', replacement: path.resolve(srcRoot, '_data') },
      { find: '@_http', replacement: path.resolve(srcRoot, '_http') },
      { find: '@_api', replacement: path.resolve(srcRoot, '_api') },
      { find: '@mocks', replacement: path.resolve(srcRoot, 'mocks') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/vite-env.d.ts', 'types.d.ts'],
    },
  },
});
