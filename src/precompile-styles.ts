import fs from 'fs';
import path from 'path';

import * as sass from 'sass';

interface StyleEntry {
  input: string;
  output: string;
}

const entries: StyleEntry[] = [
  { input: 'src/styles/root.scss', output: 'dist/styles/root.css' },
  { input: 'src/styles/pl-states.scss', output: 'dist/styles/pl-states.css' },
];

// Normalize line endings to LF so output is consistent across Windows and Unix
const normalizeLf = (text: string): string => text.replace(/\r\n?/g, '\n');

export interface CompileDependencies {
  compile: typeof sass.compile;
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
}

const defaultDependencies: CompileDependencies = {
  compile: sass.compile,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
};

/**
 * Compiles SCSS entries to CSS with embedded source maps.
 * Source maps include original SCSS content (sourceMapIncludeSources)
 * so consumers don't need the raw .scss files.
 */
export function compileStyles(rootDir: string, deps: CompileDependencies = defaultDependencies): void {
  for (const { input, output } of entries) {
    const inputPath = path.resolve(rootDir, input);
    const outputPath = path.resolve(rootDir, output);

    deps.mkdirSync(path.dirname(outputPath), { recursive: true });

    const result = deps.compile(inputPath, {
      style: 'compressed',
      sourceMap: true,
      sourceMapIncludeSources: true,
    });

    const mapFileName = path.basename(output) + '.map';
    const cssOut = normalizeLf(result.css);

    // Normalize CRLF in embedded source content for cross-platform consistency
    const sourceMap = result.sourceMap as unknown as { sources?: string[]; sourcesContent?: Array<string | null> };

    if (Array.isArray(sourceMap?.sources)) {
      sourceMap.sources = sourceMap.sources.map((s) => (path.isAbsolute(s) ? path.relative(rootDir, s) : s).replace(/\\/g, '/'));
    }

    if (Array.isArray(sourceMap?.sourcesContent)) {
      sourceMap.sourcesContent = sourceMap.sourcesContent.map((c) => (typeof c === 'string' ? normalizeLf(c) : c));
    }

    const sourceMapJson = JSON.stringify(sourceMap ?? {});

    // Append sourceMappingURL so browsers/dev tools can locate the .map file
    deps.writeFileSync(outputPath, cssOut + `\n/*# sourceMappingURL=${mapFileName} */`);
    deps.writeFileSync(outputPath + '.map', sourceMapJson);

    console.log(`compiled: ${input} → ${output}`);
  }
}

/* v8 ignore next 4 -- exercised via `bun src/precompile-styles.ts`, not via unit tests */
if (import.meta.main) {
  compileStyles(path.resolve(import.meta.dirname, '..'));
}
