import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getPackageRoot } from './paths.ts';

export interface ScaffoldDependencies {
  existsSync: typeof fs.existsSync;
  readdirSync: typeof fs.readdirSync;
  cpSync: typeof fs.cpSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  renameSync: typeof fs.renameSync;
  execFileSync: typeof execFileSync;
}

const defaultDependencies: ScaffoldDependencies = { ...fs, execFileSync };

const isTemplateInput = (relativePath: string): boolean => {
  const file = relativePath.replaceAll('\\', '/');
  const localArtifact =
    /(?:^|\/)(?:node_modules|\.git|\.npmignore)(?:\/|$)|^(?:dist|coverage|build|out|\.next|\.turbo)(?:\/|$)|(?:^|\/)\.env(?:\.[^/]+)?\.local$|\.(?:pem|tsbuildinfo)$|\.timestamp-.*\.mjs$|(?:^|\/)\.DS_Store$|-(?:debug|error)\.log/.test(
      file
    );

  return (
    !localArtifact &&
    file !== 'public/pl-states.json' &&
    (!file.startsWith('public/assets/') || /^public\/assets\/(?:vendors|fonts|images)(?:\/|$)/.test(file))
  );
};

export function scaffoldProject(
  projectName: string,
  { cwd = process.cwd(), packageRoot = getPackageRoot(), install = false }: { cwd?: string; packageRoot?: string; install?: boolean } = {},
  dependencies: ScaffoldDependencies = defaultDependencies
): string {
  const target = path.resolve(cwd, projectName);
  const name = path.basename(target).toLowerCase().replace(/\s+/g, '-');

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) {
    throw new Error('The project directory must have a valid package-name basename (letters, numbers, dots, underscores, or hyphens).');
  }
  if (dependencies.existsSync(target) && dependencies.readdirSync(target).length > 0) {
    throw new Error(`Directory "${projectName}" already exists and is not empty.`);
  }

  const template = path.join(packageRoot, 'template');

  if (!dependencies.existsSync(template)) throw new Error('Alveo starter template is missing from the installed package.');

  if (install) {
    try {
      dependencies.execFileSync('bun', ['--version'], { stdio: 'ignore' });
    } catch (cause) {
      throw new Error('Bun is required for --install and starter scripts. Install Bun or scaffold without --install.', { cause });
    }
  }

  const manifest = JSON.parse(dependencies.readFileSync(path.join(template, 'package.json'), 'utf8'));
  const { version } = JSON.parse(dependencies.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  manifest.name = name;
  manifest.devDependencies.alveo = `^${version}`;

  // Source checkouts can contain local secrets, installed dependencies and old
  // build output. Match the packer's clean-template boundary when scaffolding
  // directly from a checkout, not only from an already-filtered npm tarball.
  dependencies.cpSync(template, target, {
    recursive: true,
    filter: (source) => isTemplateInput(path.relative(template, source)),
  });
  // npm strips nested .gitignore files. The neutral source name survives both
  // npm and Bun packing; JSON serialization also avoids '$' replacement tokens.
  dependencies.renameSync(path.join(target, '_gitignore'), path.join(target, '.gitignore'));
  dependencies.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

  if (install) dependencies.execFileSync('bun', ['install'], { cwd: target, stdio: 'inherit' });

  return target;
}
