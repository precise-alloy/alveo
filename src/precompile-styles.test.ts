// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { compileStyles, CompileDependencies } from './precompile-styles.js';

describe('precompile-styles', () => {
  const createMockDeps = () => {
    const written: Record<string, string> = {};
    const dirs: string[] = [];

    const deps: CompileDependencies = {
      compile: vi.fn().mockReturnValue({
        css: 'body{color:red}',
        sourceMap: {
          version: 3,
          sources: ['root.scss'],
          sourcesContent: ['body { color: red; }'],
          mappings: 'AAAA',
        },
      }),
      mkdirSync: vi.fn(((p: string) => {
        dirs.push(p);
      }) as typeof import('fs').mkdirSync),
      writeFileSync: vi.fn(((p: string, content: string) => {
        written[p] = content;
      }) as typeof import('fs').writeFileSync),
    };

    return { deps, written, dirs };
  };

  it('compiles both entry files', () => {
    const { deps } = createMockDeps();

    compileStyles('/project', deps);

    expect(deps.compile).toHaveBeenCalledTimes(2);
  });

  it('creates output directories', () => {
    const { deps, dirs } = createMockDeps();

    compileStyles('/project', deps);

    expect(dirs.length).toBe(2);
    dirs.forEach((d) => expect(d).toContain('dist'));
  });

  it('passes compressed style and sourceMap options to sass', () => {
    const { deps } = createMockDeps();

    compileStyles('/project', deps);

    expect(deps.compile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        style: 'compressed',
        sourceMap: true,
        sourceMapIncludeSources: true,
      })
    );
  });

  it('writes CSS with sourceMappingURL comment', () => {
    const { deps, written } = createMockDeps();

    compileStyles('/project', deps);

    const cssFiles = Object.keys(written).filter((k) => k.endsWith('.css') && !k.endsWith('.css.map'));

    expect(cssFiles.length).toBe(2);
    cssFiles.forEach((f) => {
      expect(written[f]).toContain('body{color:red}');
      expect(written[f]).toContain('/*# sourceMappingURL=');
    });
  });

  it('writes source map files alongside CSS', () => {
    const { deps, written } = createMockDeps();

    compileStyles('/project', deps);

    const mapFiles = Object.keys(written).filter((k) => k.endsWith('.css.map'));

    expect(mapFiles.length).toBe(2);
    mapFiles.forEach((f) => {
      const parsed = JSON.parse(written[f]!);

      expect(parsed.version).toBe(3);
      expect(parsed.sourcesContent).toBeDefined();
    });
  });

  it('normalizes CRLF in CSS output', () => {
    const { deps, written } = createMockDeps();

    (deps.compile as ReturnType<typeof vi.fn>).mockReturnValue({
      css: 'a{\r\ncolor:red\r\n}',
      sourceMap: { version: 3, sources: [], sourcesContent: [], mappings: '' },
    });

    compileStyles('/project', deps);

    const cssFiles = Object.keys(written).filter((k) => k.endsWith('.css') && !k.endsWith('.css.map'));

    cssFiles.forEach((f) => {
      expect(written[f]).not.toContain('\r');
    });
  });

  it('normalizes CRLF in embedded source content', () => {
    const { deps, written } = createMockDeps();

    (deps.compile as ReturnType<typeof vi.fn>).mockReturnValue({
      css: 'a{color:red}',
      sourceMap: {
        version: 3,
        sources: ['test.scss'],
        sourcesContent: ['body {\r\n  color: red;\r\n}'],
        mappings: 'AAAA',
      },
    });

    compileStyles('/project', deps);

    const mapFiles = Object.keys(written).filter((k) => k.endsWith('.css.map'));

    mapFiles.forEach((f) => {
      const parsed = JSON.parse(written[f]!);

      parsed.sourcesContent.forEach((content: string) => {
        expect(content).not.toContain('\r');
      });
    });
  });

  it('skips sourcesContent normalization when sourcesContent is missing', () => {
    const { deps, written } = createMockDeps();

    (deps.compile as ReturnType<typeof vi.fn>).mockReturnValue({
      css: 'a{color:red}',
      sourceMap: {
        version: 3,
        sources: ['test.scss'],
        mappings: 'AAAA',
      },
    });
    expect(() => compileStyles('/project', deps)).not.toThrow();
    const mapFiles = Object.keys(written).filter((k) => k.endsWith('.css.map'));

    mapFiles.forEach((f) => {
      const parsed = JSON.parse(written[f]!);

      expect(parsed.sourcesContent).toBeUndefined();
    });
  });
  it('preserves non-string (null) sourcesContent entries', () => {
    const { deps, written } = createMockDeps();

    (deps.compile as ReturnType<typeof vi.fn>).mockReturnValue({
      css: 'a{color:red}',
      sourceMap: {
        version: 3,
        sources: ['test.scss'],
        sourcesContent: [null],
        mappings: 'AAAA',
      },
    });
    compileStyles('/project', deps);
    const mapFiles = Object.keys(written).filter((k) => k.endsWith('.css.map'));

    mapFiles.forEach((f) => {
      const parsed = JSON.parse(written[f]!);

      expect(parsed.sourcesContent).toEqual([null]);
    });
  });
});
