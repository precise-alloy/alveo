import path from 'path';
import fs from 'node:fs';

import slash from 'slash';

import { hashFileContent, hasContentHashInFileName, parsePrerenderArgs } from './prerender-core.ts';
import { normalizeTextLikeContent, normalizeTextLineEndings } from './text-normalization.ts';

export interface CopyItem {
  from: string;
  to?: string;
}

export interface FileExistCheck {
  folder?: string;
  fileName: string | RegExp;
}

export interface IntegrationDependencies {
  existsSync: (value: string) => boolean;
  statSync: (value: string) => { isDirectory: () => boolean };
  rmSync: (target: string, options?: { recursive?: boolean; force?: boolean }) => void;
  mkdirSync: (target: string, options?: { recursive?: boolean }) => void;
  cpSync: (source: string, destination: string, options?: { recursive?: boolean; force?: boolean }) => void;
  copyFileSync: (source: string, destination: string) => void;
  readFileSync: (path: string, encoding?: BufferEncoding) => string | Buffer;
  writeFileSync: (path: string, data: string) => void;
  readdirSync: (path: string) => string[];
  globSync: (pattern: string, options?: { nodir?: boolean }) => string[];
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
  warn: (value: string) => unknown;
}

export interface IntegrationConfig {
  argv: string[];
  staticBasePath: string;
  srcBasePath: string;
  destBasePath: string;
  patternPath?: string;
  copyItems: CopyItem[];
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

export const copyConfiguredItems = (
  copyItems: CopyItem[],
  { srcBasePath, destBasePath }: Pick<IntegrationConfig, 'srcBasePath' | 'destBasePath'>,
  dependencies: IntegrationDependencies
): void => {
  copyItems.forEach((item) => {
    const srcPath = slash(path.join(srcBasePath, item.from));
    const destPath = slash(item.to ?? path.join(destBasePath, item.from));

    if (!dependencies.existsSync(srcPath)) {
      return;
    }

    dependencies.log(`Copy file ${srcPath} to ${destPath}`);

    if (dependencies.statSync(srcPath).isDirectory()) {
      if (dependencies.existsSync(destPath)) {
        dependencies.rmSync(destPath, { recursive: true, force: true });
      }

      dependencies.mkdirSync(destPath, { recursive: true });
      dependencies.cpSync(srcPath, destPath, { recursive: true, force: true });
    } else {
      const destDirPath = path.dirname(destPath);

      if (!dependencies.existsSync(destDirPath)) {
        // Recursive create so a missing destination parent does not throw
        dependencies.mkdirSync(destDirPath, { recursive: true });
      }

      dependencies.copyFileSync(srcPath, destPath);
    }
  });
};

/**
 * Returns copy items for every top-level entry in `srcBasePath` that the
 * configured items do not already cover.
 *
 * Vite emits assets without a dedicated folder (e.g. `.mp4`, `.pdf`, `.wasm`)
 * directly into `assets/`, and `public/assets/**` can add arbitrary files or
 * folders there too. An allowlist of known folders silently dropped those, so
 * integration "succeeded" while deployed references were broken. Copying the
 * remainder (dirs replaced, files overwritten) mirrors the build output
 * without hard-coding every extension the asset naming might route to root.
 */
export const getUnlistedCopyItems = (
  copyItems: CopyItem[],
  srcBasePath: string,
  dependencies: Pick<IntegrationDependencies, 'existsSync' | 'readdirSync'>
): CopyItem[] => {
  if (!dependencies.existsSync(srcBasePath)) {
    return [];
  }

  const listed = new Set(copyItems.map((item) => item.from));

  return dependencies
    .readdirSync(srcBasePath)
    .filter((entry) => !listed.has(entry))
    .sort()
    .map((entry) => ({ from: entry }));
};

export const collectAssetHashes = (
  hashItems: string[],
  { staticBasePath, srcBasePath }: Pick<IntegrationConfig, 'staticBasePath' | 'srcBasePath'>,
  dependencies: Pick<IntegrationDependencies, 'globSync' | 'readFileSync'>
): Map<string, string> => {
  const hashes: Map<string, string> = new Map();

  hashItems.forEach((item) => {
    const srcPath = slash(path.join(srcBasePath, item));
    const files = dependencies.globSync(srcPath + '/**/*.{css,js,svg}');

    files.forEach((file) => {
      const relativePath = slash(file.substring(staticBasePath.length));
      const fileContent = dependencies.readFileSync(file);

      if (!hasContentHashInFileName(file)) {
        hashes.set(relativePath, hashFileContent(normalizeTextLikeContent(file, fileContent)));
      } else {
        hashes.set(relativePath, '');
      }
    });
  });

  return hashes;
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

export const getPatternCopyTarget = (
  patternPath: string,
  sourcePath: string,
  staticBasePath?: string
): { sourcePath: string; targetPath: string; recursive: boolean } | undefined => {
  const relativePath = staticBasePath ? slash(path.relative(staticBasePath, sourcePath)) : slash(sourcePath);
  const segments = relativePath.split('/');

  if (segments.length < 2) {
    return undefined;
  }

  return {
    sourcePath,
    targetPath: slash(path.join(patternPath, segments.join('-'))),
    recursive: segments.length > 2,
  };
};

export const normalizePatternHtml = (text: string): string => {
  return normalizeTextLineEndings(text)
    .replaceAll(/react-loader\.0x[a-z0-9_-]{8,12}\.js/gi, 'react-loader.0x00000000.js')
    .replaceAll(/\.svg\?v=[a-z0-9_-]+/gi, '.svg')
    .replaceAll(/(<\/footer>)\n{2,}(\s*<script\s+type="module"\n\s+defer=""\n\s+src="\/assets\/js\/pl-states\.js"><\/script>)/g, '$1\n$2');
};

export const normalizeGeneratedTextFiles = (
  targetPath: string,
  dependencies: Pick<IntegrationDependencies, 'globSync' | 'readFileSync' | 'writeFileSync'>
): void => {
  dependencies.globSync(slash(path.join(targetPath, '**/*')), { nodir: true }).forEach((file) => {
    const fileContent = dependencies.readFileSync(file);
    const text = typeof fileContent === 'string' ? fileContent : fileContent.toString('utf-8');
    const newText = normalizeTextLikeContent(file, fileContent);

    if (typeof newText === 'string' && text !== newText) {
      dependencies.writeFileSync(file, newText);
    }
  });
};

export const copyPatternArtifacts = (
  patternPath: string,
  staticBasePath: string,
  dependencies: Pick<IntegrationDependencies, 'mkdirSync' | 'globSync' | 'copyFileSync' | 'cpSync'>
): void => {
  dependencies.mkdirSync(patternPath, { recursive: true });
  dependencies.globSync(slash(path.join(staticBasePath, '{atoms,molecules,organisms,templates,pages}/**/*.*'))).forEach((patternSource) => {
    const target = getPatternCopyTarget(patternPath, patternSource, staticBasePath);

    if (!target) {
      return;
    }

    if (target.recursive) {
      dependencies.cpSync(target.sourcePath, target.targetPath, { recursive: true });
    } else {
      dependencies.copyFileSync(target.sourcePath, target.targetPath);
    }
  });
};

export const normalizePatternFiles = (
  patternPath: string,
  dependencies: Pick<IntegrationDependencies, 'globSync' | 'readFileSync' | 'writeFileSync'>
): void => {
  dependencies.globSync(slash(path.join(patternPath, '**/*.{htm,html}'))).forEach((patternFile) => {
    const fileContent = dependencies.readFileSync(patternFile, 'utf-8');
    const text = typeof fileContent === 'string' ? fileContent : fileContent.toString('utf-8');
    const newText = normalizePatternHtml(text);

    if (text !== newText) {
      dependencies.writeFileSync(patternFile, newText);
    }
  });
};

export const validateExpectedFiles = (
  checkExistFileList: FileExistCheck[],
  destBasePath: string,
  dependencies: Pick<IntegrationDependencies, 'existsSync' | 'readdirSync' | 'log' | 'warn'>
): { isValid: boolean; missing: string[] } => {
  const missing: string[] = [];

  checkExistFileList.forEach((file) => {
    if (typeof file.fileName === 'string') {
      const destPath = slash(path.join(destBasePath, file.folder ?? '', file.fileName.toString()));

      if (!dependencies.existsSync(destPath)) {
        missing.push(destPath);
        dependencies.log(dependencies.warn(`Cannot find: ${destPath}`));
      }
    } else {
      const fileName = new RegExp(file.fileName.source, file.fileName.flags.replace(/[gy]/g, ''));
      const folderFiles = slash(path.join(destBasePath, file.folder ?? ''));
      const files = dependencies.readdirSync(folderFiles);
      const found = files.find((fileEntry) => fileName.test(fileEntry));

      if (!found) {
        const missingPath = slash(path.join(folderFiles, fileName.toString()));

        missing.push(missingPath);
        dependencies.log(dependencies.warn(`Cannot find: ${missingPath}`));
      }
    }
  });

  return {
    isValid: missing.length === 0,
    missing,
  };
};

export const runIntegrationBuild = (config: IntegrationConfig, dependencies: IntegrationDependencies): { isValid: boolean; missing: string[] } => {
  if (config.patternPath && dependencies.existsSync(config.patternPath)) {
    dependencies.rmSync(config.patternPath, { recursive: true, force: true });
    dependencies.mkdirSync(config.patternPath, { recursive: true });
  }

  copyConfiguredItems(config.copyItems, config, dependencies);
  copyConfiguredItems(getUnlistedCopyItems(config.copyItems, config.srcBasePath, dependencies), config, dependencies);

  const hashes = collectAssetHashes(config.hashItems, config, dependencies);
  const sortedHashes = sortHashes(hashes);

  dependencies.writeFileSync(path.join(config.destBasePath, 'hashes.json'), JSON.stringify(sortedHashes, null, '  '));
  normalizeGeneratedTextFiles(config.destBasePath, dependencies);

  if (config.patternPath) {
    copyPatternArtifacts(config.patternPath, config.staticBasePath, dependencies);
    normalizePatternFiles(config.patternPath, dependencies);
  }

  return validateExpectedFiles(config.checkExistFileList, config.destBasePath, dependencies);
};
