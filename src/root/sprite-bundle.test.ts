// @vitest-environment node

import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { describe, expect, it } from 'vitest';

describe('catalog sprite bundles', () => {
  it.each(['frame-controls.tsx', 'active-item-options.tsx', 'root-nav.tsx'])(
    'keeps %s sprite references external regardless of the consumer inline limit',
    async (component) => {
      // Build each consumer separately: one correct import must not hide another
      // that still inlines the same sprite. SVG <use> cannot load data URLs.
      const result = await build({
        configFile: false,
        root: fileURLToPath(new URL('../../', import.meta.url)),
        publicDir: false,
        base: '/catalog/',
        logLevel: 'error',
        build: {
          write: false,
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          rolldownOptions: {
            input: fileURLToPath(new URL(component, import.meta.url)),
            preserveEntrySignatures: 'strict',
          },
        },
      });

      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single non-watch Vite build.');
      const sprites = result.output.filter((file) => file.type === 'asset' && /\/root-[^/]+\.svg$/.test(file.fileName));
      const code = result.output
        .filter((file) => file.type === 'chunk')
        .map((file) => file.code)
        .join('\n');

      expect(sprites).toHaveLength(1);
      expect(code).toContain('/catalog/' + sprites[0]!.fileName);
      expect(code).not.toContain('data:image/svg+xml');
    }
  );
});
