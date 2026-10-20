import type { RawSourceMap } from 'source-map-js';

import fs from 'node:fs';
import path from 'node:path';

import * as sass from 'sass';
import browserslist from 'browserslist';
import { browserslistToTargets } from 'lightningcss';

import { stripInjectedPreludeFromSourceMap, transformStyleCss } from './styles-core.ts';

export interface CompileDependencies {
  compile: typeof sass.compile;
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
  transformCss: typeof transformStyleCss;
}

const defaultDependencies: CompileDependencies = {
  compile: sass.compile,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  transformCss: transformStyleCss,
};

export function compileStyles(rootDir: string, deps: CompileDependencies = defaultDependencies): void {
  const targets = browserslistToTargets(browserslist(undefined, { path: rootDir }));

  for (const name of ['root', 'pl-states']) {
    const input = `src/styles/${name}.scss`;
    const output = path.resolve(rootDir, `dist/styles/${name}.css`);
    const result = deps.compile(path.resolve(rootDir, input), {
      // Preserve cross-module mappings; LightningCSS performs final minification.
      style: 'expanded',
      sourceMap: true,
      sourceMapIncludeSources: true,
    });

    if (!result.sourceMap) throw new Error(`Sass did not produce a source map for ${input}`);
    const map = stripInjectedPreludeFromSourceMap(result.sourceMap as RawSourceMap, undefined, { projectRoot: rootDir });
    const transformed = deps.transformCss(result.css, map, input, targets);

    deps.mkdirSync(path.dirname(output), { recursive: true });
    deps.writeFileSync(output, transformed.css + `\n/*# sourceMappingURL=${name}.css.map */`);
    deps.writeFileSync(output + '.map', transformed.map);
    console.log(`compiled: ${input} -> dist/styles/${name}.css`);
  }
}

/* v8 ignore next 3 -- exercised by the packed-package test */
if (import.meta.main) {
  compileStyles(path.resolve(import.meta.dirname, '..'));
}
