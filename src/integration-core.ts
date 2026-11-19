import path from 'path';
import { isUtf8 } from 'node:buffer';
import fs from 'node:fs';

import * as cheerio from 'cheerio';
import MagicString from 'magic-string';
import slash from 'slash';

import { hashFileContent, hasContentHashInFileName, parsePrerenderArgs } from './prerender-core.ts';
import { normalizeTextLikeContent, normalizeTextLineEndings } from './text-normalization.ts';

export interface FileExistCheck {
  folder?: string;
  fileName: string | RegExp;
}

export interface IntegrationConfig {
  projectRoot: string;
  staticBasePath: string;
  srcBasePath: string;
  destBasePath: string;
  patternPath?: string;
  hashItems: string[];
  checkExistFileList: FileExistCheck[];
}

export interface DestinationValidationResult {
  ok: boolean;
  reasons: string[];
}

export interface DestinationDependencies {
  lstat: (value: string) => Pick<fs.Stats, 'isDirectory' | 'isSymbolicLink'> | undefined;
  realpath: (value: string) => string;
}

const destinationDependencies: DestinationDependencies = {
  lstat: (value) => fs.lstatSync(value, { throwIfNoEntry: false }),
  realpath: fs.realpathSync,
};

const resolveDestination = (candidate: string, dependencies: DestinationDependencies): string => {
  let existing = candidate;
  const suffix: string[] = [];
  let stats = dependencies.lstat(existing);

  while (!stats) {
    const parent = path.dirname(existing);

    if (parent === existing) throw new Error(`Cannot resolve filesystem root for ${candidate}`);
    suffix.unshift(path.basename(existing));
    existing = parent;
    stats = dependencies.lstat(existing);
  }
  const physical = dependencies.realpath(existing);
  const target = stats.isSymbolicLink() ? dependencies.lstat(physical) : stats;

  if (!target?.isDirectory()) throw new Error(`Integration destination is not a directory: ${existing}`);

  return path.resolve(physical, ...suffix);
};

const isSameOrAncestorPath = (candidatePath: string, projectRoot: string): 'same' | 'ancestor' | undefined => {
  const resolvedCandidate = slash(path.resolve(candidatePath));
  const resolvedRoot = slash(path.resolve(projectRoot));
  const relativePath = slash(path.relative(resolvedCandidate, resolvedRoot));

  if (relativePath === '') {
    return 'same';
  }

  if (relativePath !== '..' && !relativePath.startsWith('../') && !path.isAbsolute(relativePath)) {
    return 'ancestor';
  }

  return undefined;
};

const pathsOverlap = (first: string, second: string): boolean => Boolean(isSameOrAncestorPath(first, second) || isSameOrAncestorPath(second, first));

export const validateDestinations = (
  destBasePath: string,
  patternPath: string | undefined,
  projectRoot: string,
  dependencies: DestinationDependencies = destinationDependencies
): DestinationValidationResult => {
  const reasons: string[] = [];
  const destinations: Array<{ lexical: string; physical: string }> = [];
  const root = path.resolve(projectRoot);

  try {
    const physicalRoot = resolveDestination(root, dependencies);

    for (const [label, value] of [
      ['VITE_INTE_ASSET_DIR', destBasePath],
      ['VITE_INTE_PATTERN_DIR', patternPath],
    ]) {
      if (value === undefined) continue;
      if (!value.trim()) {
        reasons.push(`${label} is empty`);
        continue;
      }
      const lexical = path.resolve(root, value.trim());
      const physical = resolveDestination(lexical, dependencies);
      const risk = isSameOrAncestorPath(lexical, root) ?? isSameOrAncestorPath(physical, physicalRoot);

      if (risk === 'same') reasons.push(`${label} resolves to project root`);
      else if (risk === 'ancestor') reasons.push(`${label} is an ancestor of project root`);
      else if (isSameOrAncestorPath(root, lexical) || isSameOrAncestorPath(physicalRoot, physical)) {
        reasons.push(`${label} is inside project root`);
      }
      destinations.push({ lexical, physical });
    }
    const [assets, patterns] = destinations;

    // Check both spellings: an in-project symlink to an external folder is
    // still not an external output path, and two external links may alias.
    if (assets && patterns && (pathsOverlap(assets.lexical, patterns.lexical) || pathsOverlap(assets.physical, patterns.physical)))
      reasons.push('Integration destinations must not overlap each other');
  } catch (error) {
    reasons.push(`Cannot validate integration destinations: ${String(error)}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
};

export const parseIntegrationArgs = (argv: string[]) => {
  return {
    mode: parsePrerenderArgs(argv).mode,
  };
};

export const sortHashes = (hashes: Map<string, string>): { [key: string]: string } => {
  return Array.from(hashes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .reduce(
      (obj, [key, value]) => {
        obj[key] = value;

        return obj;
      },
      {} as { [key: string]: string }
    );
};

export const normalizePatternHtml = (text: string): string => {
  const html = normalizeTextLineEndings(text)
    .replaceAll(/react-loader\.0x[a-z0-9_-]{8,12}\.js/gi, 'react-loader.0x00000000.js')
    .replaceAll(/\.svg\?v=[a-z0-9_-]+/gi, '.svg')
    .replaceAll(/(<\/footer>)\n{2,}(\s*<script\s+type="module"\n\s+defer=""\n\s+src="\/assets\/js\/pl-states\.js"><\/script>)/g, '$1\n$2');

  if (!html.includes('rolldown-runtime.')) return html;

  // Backend samples list entry assets, not the loader's internal CommonJS
  // helper. Its ES import still loads the copied chunk; keep the preload in
  // dist/static HTML for performance, but omit this optional hint in patterns.
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  const result = new MagicString(html);

  $('link[rel="modulepreload"][href]').each((_, element) => {
    const pathname = $(element).attr('href')!.split(/[?#]/, 1)[0]!;

    if (!/(?:^|\/)rolldown-runtime\.0x[a-z0-9_-]{8,12}\.js$/i.test(pathname)) return;

    // Literal link nodes have parse5 source offsets. Edit those bytes rather
    // than reserializing: preserve formatting and script/comment examples.
    const { startOffset, endOffset } = element.sourceCodeLocation!;
    const lineStart = html.lastIndexOf('\n', startOffset - 1) + 1;
    const trailingWhitespace = /^[\t ]*(?:\n|$)/.exec(html.slice(endOffset));
    const standalone = /^[\t ]*$/.test(html.slice(lineStart, startOffset)) && trailingWhitespace;

    result.remove(standalone ? lineStart : startOffset, standalone ? endOffset + standalone[0].length : endOffset);
  });

  return result.toString();
};

export const validateExpectedFiles = (
  checkExistFileList: FileExistCheck[],
  destBasePath: string,
  generated: Set<string>
): { isValid: boolean; missing: string[] } => {
  const missing: string[] = [];

  for (const { folder = '', fileName } of checkExistFileList) {
    const prefix = folder && folder + '/';
    const matcher = typeof fileName === 'string' ? undefined : new RegExp(fileName.source, fileName.flags.replace(/[gy]/g, ''));
    const matches =
      typeof fileName === 'string'
        ? generated.has(prefix + fileName)
        : [...generated].some((file) => path.posix.dirname(file) === (folder || '.') && matcher!.test(path.posix.basename(file)));

    if (!matches) missing.push(path.join(destBasePath, folder, String(fileName)));
  }

  return {
    isValid: missing.length === 0,
    missing,
  };
};

const ownershipFile = '.alveo-integration.json';

type DestinationKind = 'assets' | 'patterns';
interface OutputPlan {
  root: string;
  kind: DestinationKind;
  // Keep the source, not its contents, to avoid buffering the whole build.
  files: Map<string, () => string | Buffer>;
}

const canonical = (name: string) => name.normalize('NFC').toLowerCase();

// Manifests travel with reviewed output (including across operating systems).
// Never normalize a manifest entry into a different filename or a parent path.
function validateRelativePath(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    name
      .split('/')
      .some((part) => !part || /[\\:<>"|?*\p{Cc}]/u.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
    canonical(name.split('/')[0]!) === ownershipFile
  ) {
    throw new Error(`Unsafe integration output path: ${String(name)}`);
  }
}

const planFile = (plan: OutputPlan, name: string, content: () => string | Buffer) => {
  validateRelativePath(name);
  if (plan.files.has(name)) throw new Error(`Duplicate integration output: ${path.join(plan.root, name)}`);
  plan.files.set(name, content);
};

// Inventory source files, including dotfiles in mirrored assets. Reject links
// rather than copying a link into a tree that a later publish will write to.
function* sourceFiles(root: string, prefix = '', skipHidden = false): Generator<string> {
  // path.resolve strips the trailing separator in prefix. lstat("link/")
  // would otherwise follow a directory link even though lstat("link") does not.
  const directory = path.resolve(root, prefix);

  if (!fs.lstatSync(directory).isDirectory()) throw new Error(`Expected build directory: ${directory}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipHidden && entry.name.startsWith('.')) continue;
    const name = prefix + entry.name;

    if (entry.isDirectory()) yield* sourceFiles(root, name + '/', skipHidden);
    else if (entry.isFile()) yield name;
    else throw new Error(`Not a regular build output: ${path.join(root, name)}`);
  }
}

const patternHtml = (name: string) => /\.html?$/i.test(name);

const planCopy = (plan: OutputPlan, name: string, source: string) => {
  if (plan.kind === 'patterns' && patternHtml(name) && !fs.statSync(source).size) throw new Error(`Empty generated HTML pattern: ${source}`);
  planFile(plan, name, () => {
    const bytes = fs.readFileSync(source);

    // Unknown public assets may have a text-like prefix and binary data
    // beyond the normalizer's sample. Never re-encode invalid UTF-8 bytes.
    if (plan.kind === 'assets') return isUtf8(bytes) ? normalizeTextLikeContent(name, bytes) : bytes;

    return patternHtml(name) ? normalizePatternHtml(bytes.toString('utf8')) : bytes;
  });
};

const assetHashManifest = (assets: OutputPlan, config: IntegrationConfig): string => {
  // Use the same normalized source bytes and public URLs as the previous
  // hashes.json, without a second filesystem walk (or globbing user paths).
  const hashes = new Map<string, string>();

  for (const [name, content] of assets.files) {
    if (config.hashItems.includes(name.split('/')[0]!) && !name.includes('/.') && /\.(css|js|svg)$/.test(name)) {
      const url = '/' + slash(path.relative(config.staticBasePath, path.join(config.srcBasePath, name)));

      hashes.set(url, hasContentHashInFileName(name) ? '' : hashFileContent(content()));
    }
  }

  return JSON.stringify(sortHashes(hashes), null, '  ');
};

const planOutputs = (config: IntegrationConfig): OutputPlan[] => {
  const { srcBasePath, staticBasePath, destBasePath, patternPath } = config;
  const assets: OutputPlan = { root: destBasePath, kind: 'assets', files: new Map() };
  const patterns: OutputPlan | undefined = patternPath ? { root: patternPath, kind: 'patterns', files: new Map() } : undefined;

  for (const name of sourceFiles(srcBasePath)) {
    // The generated manifest supersedes any hashes.json in public/assets.
    if (name === 'hashes.json') continue;
    const source = path.join(srcBasePath, name);

    if (patterns && name.startsWith('pages/')) planCopy(patterns, name.slice('pages/'.length), source);
    else planCopy(assets, name, source);
  }
  planFile(assets, 'hashes.json', () => assetHashManifest(assets, config));
  if (!patterns) return [assets];
  for (const group of ['atoms', 'molecules', 'organisms', 'templates', 'pages']) {
    if (!fs.lstatSync(path.join(staticBasePath, group), { throwIfNoEntry: false })) continue;
    for (const name of sourceFiles(staticBasePath, group + '/', true)) {
      if (path.posix.basename(name).includes('.')) planCopy(patterns, name.replaceAll('/', '-'), path.join(staticBasePath, name));
    }
  }

  return [assets, patterns];
};

const readOwnership = ({ root, kind }: OutputPlan): Set<string> | undefined => {
  const record = path.join(root, ownershipFile);
  const stat = fs.lstatSync(record, { throwIfNoEntry: false });

  if (!stat) {
    if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error(`Unowned integration destination is not empty: ${root}`);

    return undefined;
  }
  if (!stat.isFile()) throw new Error(`Not a regular ownership record: ${record}`);
  let data;

  try {
    data = JSON.parse(fs.readFileSync(record, 'utf8'));
  } catch (cause) {
    throw new Error(`Cannot read integration ownership record: ${record}`, { cause });
  }
  if (data?.version !== 1 || data.kind !== kind || !Array.isArray(data.files)) throw new Error(`Invalid integration ownership record: ${record}`);
  const previous = new Set<string>();

  for (const name of data.files) {
    validateRelativePath(name);
    if (previous.has(name)) throw new Error(`Duplicate path in ${record}: ${name}`);
    previous.add(name);
  }

  return previous;
};

const preflight = (plan: OutputPlan) => {
  const previous = readOwnership(plan);
  const existing = new Set<string>();
  const spellings = new Map<string, string>();
  const names = new Set([...(previous ?? []), ...plan.files.keys()]);

  // Check ancestors before leaves, including for stale entries. A junction
  // substituted for an owned parent must not redirect either writes or deletes.
  for (const name of names) {
    let prefix = '';

    for (const part of name.split('/')) {
      prefix = prefix ? prefix + '/' + part : part;
      const target = path.join(plan.root, prefix);
      const key = canonical(prefix);

      if (spellings.has(key) && spellings.get(key) !== prefix) throw new Error(`Ambiguous integration path: ${target}`);
      spellings.set(key, prefix);
      const stat = fs.lstatSync(target, { throwIfNoEntry: false });

      if (prefix !== name) {
        if (names.has(prefix) || (stat && !stat.isDirectory())) throw new Error(`Integration parent collision: ${target}`);
      } else if (stat) {
        if (!previous?.has(name) || !stat.isFile()) throw new Error(`Integration file collision: ${target}`);
        existing.add(name);
      }
    }
  }

  return { ...plan, existing, hasRecord: previous !== undefined };
};

export const runIntegrationBuild = (config: IntegrationConfig): { isValid: boolean; missing: string[] } => {
  const destinations = validateDestinations(config.destBasePath, config.patternPath, config.projectRoot);

  if (!destinations.ok) return { isValid: false, missing: destinations.reasons };

  // Both roots, including their stale files, must pass before even mkdir.
  const plans = planOutputs(config).map(preflight);
  const assets = plans[0]!;
  const patterns = plans[1];
  const result = validateExpectedFiles(config.checkExistFileList, assets.root, new Set(assets.files.keys()));

  if (patterns && ![...patterns.files.keys()].some(patternHtml)) {
    result.missing.push(`No generated HTML patterns for ${patterns.root}`);
    result.isValid = false;
  }
  if (!result.isValid) return result;

  for (const { root, existing, files } of plans) {
    fs.mkdirSync(root, { recursive: true });
    // Unlink only preflighted regular files. Do not truncate their inode
    // (there may be unrelated hard links), or recursively remove directories.
    for (const [name, content] of files) {
      const file = path.join(root, name);
      const bytes = content();

      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (existing.delete(name)) fs.unlinkSync(file);
      fs.writeFileSync(file, bytes, { flag: 'wx' });
    }
    for (const stale of existing) fs.unlinkSync(path.join(root, stale));
  }
  for (const { root, kind, files, hasRecord } of plans) {
    const record = path.join(root, ownershipFile);

    if (hasRecord) fs.unlinkSync(record);
    fs.writeFileSync(record, JSON.stringify({ version: 1, kind, files: [...files.keys()].sort() }, null, 2) + '\n', { flag: 'wx' });
  }

  return result;
};
