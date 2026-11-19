import { isUtf8 } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import { isTextLikeContent, isTextLikePath, normalizeTextFileContent } from './text-normalization.ts';

// Vite copies publicDir independently of Rolldown. Restrict post-processing
// to this build's inventory, even when the consumer sets emptyOutDir: false.
export function normalizeStaticOutput(outDir: string, generated: string[], publicDir: string | false): void {
  if (!fs.lstatSync(outDir).isDirectory()) return;
  const root = fs.realpathSync(outDir);
  const names = new Set(generated);

  if (publicDir && fs.existsSync(publicDir)) {
    const source = fs.realpathSync(publicDir);

    if (source === root || root.startsWith(source + path.sep) || source.startsWith(root + path.sep)) return;
    for (const entry of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) names.add(path.relative(source, path.join(entry.parentPath, entry.name)));
    }
  }

  for (const name of names) normalizeOwnedTextFile(root, name);
}

function normalizeOwnedTextFile(root: string, name: string): void {
  if (!isTextLikePath(name)) return;
  const file = path.resolve(root, name);

  if (!file.startsWith(root + path.sep)) return;
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });

  // Neither directory symlinks nor hard-linked files grant ownership of
  // their targets. Keep binary data intact even with a text-like suffix.
  if (!stat?.isFile() || stat.nlink !== 1 || fs.realpathSync(file) !== file) return;
  const bytes = fs.readFileSync(file);

  if (!isUtf8(bytes) || !isTextLikeContent(bytes)) return;
  const text = bytes.toString('utf8');
  // Re-serialize maps with embedded source on both platforms. Otherwise
  // only the CRLF variant loses JSON indentation/trailing whitespace.
  const normalized = normalizeTextFileContent(file, text, true);

  if (normalized !== text) fs.writeFileSync(file, normalized);
}
