import fs from 'fs';
import path from 'path';

import * as sass from 'sass';

const entries = [
  { input: 'src/styles/root.scss', output: 'dist/styles/root.css' },
  { input: 'src/styles/pl-states.scss', output: 'dist/styles/pl-states.css' },
];

const rootDir = path.resolve(import.meta.dirname, '..');

for (const { input, output } of entries) {
  const inputPath = path.resolve(rootDir, input);
  const outputPath = path.resolve(rootDir, output);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const result = sass.compile(inputPath, {
    style: 'compressed',
    sourceMap: true,
    sourceMapIncludeSources: true,
  });

  const mapFileName = path.basename(output) + '.map';

  fs.writeFileSync(outputPath, result.css + `\n/*# sourceMappingURL=${mapFileName} */`);
  fs.writeFileSync(outputPath + '.map', JSON.stringify(result.sourceMap));

  console.log(`compiled: ${input} → ${output}`);
}
