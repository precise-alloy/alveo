import fs from 'node:fs';
import path from 'node:path';

import slash from 'slash';

import { getAssetVersion, hasContentHashInFileName } from './cryptography.ts';
import { normalizeTextLikeContent } from './text-normalization.ts';

// Read the final static tree: some stable scripts don't exist until Vite
// emits them. Keeping their versions in HTML avoids self-hashing bundles.
export function clientAssetVersionsJson(assetsDir: string): string {
  const files: string[] = [];

  if (fs.lstatSync(assetsDir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const ext of ['css', 'js']) {
      const dir = path.join(assetsDir, ext);

      if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.' + ext) && !hasContentHashInFileName(entry.name)) {
          files.push(slash(path.relative(assetsDir, path.join(entry.parentPath, entry.name))));
        }
      }
    }
  }

  const versions: Record<string, string> = {};

  for (const file of files.sort()) {
    versions['/assets/' + file] = getAssetVersion(normalizeTextLikeContent(file, fs.readFileSync(path.join(assetsDir, file))));
  }

  // application/json scripts are still HTML raw text: no literal '<' from
  // an asset name may start an end tag or an HTML parser escape sequence.
  return JSON.stringify(versions).replaceAll('<', '\\u003c');
}
