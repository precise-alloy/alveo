// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { compileStyles, type CompileDependencies } from './precompile-styles.ts';

const fixture = () => {
  const dependencies: CompileDependencies = {
    compile: vi.fn().mockReturnValue({
      css: 'a{color:red}',
      sourceMap: { version: 3, sources: ['/project/src/styles/root.scss'], sourcesContent: ['a {\r\ncolor:red;\r\n}'], mappings: 'AAAA' },
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    transformCss: vi.fn().mockImplementation((css, map) => ({ css, map: JSON.stringify(map) })),
  };

  return dependencies;
};

describe('precompiled framework CSS', () => {
  it('passes both entries through LightningCSS with normalized file-backed source maps', () => {
    const dependencies = fixture();

    compileStyles('/project', dependencies);
    expect(dependencies.compile).toHaveBeenCalledTimes(2);
    expect(dependencies.transformCss).toHaveBeenCalledTimes(2);
    expect(dependencies.transformCss).toHaveBeenCalledWith(
      'a{color:red}',
      expect.objectContaining({
        sources: ['src/styles/root.scss'],
        sourcesContent: ['a {\ncolor:red;\n}'],
      }),
      'src/styles/root.scss',
      expect.any(Object)
    );
    expect(dependencies.writeFileSync).toHaveBeenCalledWith(
      path.resolve('/project/dist/styles/root.css'),
      expect.stringContaining('sourceMappingURL=root.css.map')
    );
  });

  it('fails explicitly on missing maps or compiler/postprocessor errors', () => {
    const missing = fixture();

    vi.mocked(missing.compile).mockReturnValue({ css: 'a{}', loadedUrls: [] });
    expect(() => compileStyles('/project', missing)).toThrow('source map');
    const failed = fixture();

    vi.mocked(failed.transformCss).mockImplementation(() => {
      throw new Error('CSS failed');
    });
    expect(() => compileStyles('/project', failed)).toThrow('CSS failed');
    expect(failed.writeFileSync).not.toHaveBeenCalled();
  });

  it('actually lowers browser targets and preserves LF sources without local Sass files in the output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-precompile-'));

    try {
      fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true });
      fs.writeFileSync(path.join(root, '.browserslistrc'), 'Safari 12\n');
      for (const name of ['root', 'pl-states']) {
        fs.writeFileSync(path.join(root, `src/styles/${name}.scss`), '.example {\r\n  user-select: none;\r\n}\r\n');
      }
      compileStyles(root);
      const css = fs.readFileSync(path.join(root, 'dist/styles/root.css'), 'utf8');

      expect(css).toContain('-webkit-user-select');
      const map = JSON.parse(fs.readFileSync(path.join(root, 'dist/styles/root.css.map'), 'utf8'));

      expect(map.sources).toContain('src/styles/root.scss');
      expect(map.sourcesContent).toContain('.example {\n  user-select: none;\n}\n');
      expect(fs.readdirSync(path.join(root, 'dist/styles')).sort()).toEqual(['pl-states.css', 'pl-states.css.map', 'root.css', 'root.css.map']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
