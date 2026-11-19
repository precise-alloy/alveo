// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { build, mergeConfig, resolveConfig } from 'vite';

import { defineAlveoConfig } from './config.ts';

describe('Alveo configuration through Vite', () => {
  let root: string;

  beforeEach(() => {
    // Vite derives HTML asset names relative to its canonical root. Use the
    // same spelling for entry paths when Windows TEMP uses an 8.3 alias.
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-config-base-')));
    fs.writeFileSync(path.join(root, '.env'), 'VITE_BASE_URL=/env/\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('builds a ?worker whose runtime URL points to the hashed worker payload under assets/js', async () => {
    const scripts = path.join(root, 'src/assets/scripts');

    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<html><body></body></html>');
    fs.writeFileSync(path.join(scripts, 'layout.entry.ts'), "import Worker from './layout-worker.min.js?worker'; new Worker();");
    fs.writeFileSync(path.join(scripts, 'layout-worker.min.js'), 'self.postMessage("layout ready");');
    await build({ ...defineAlveoConfig({ root, base: '/site/' }), configFile: false, logLevel: 'error' });

    // Execute the importer with a recording constructor. A matching filename
    // in the output listing alone might be the wrapper rather than its payload.
    const urls: string[] = [];

    runInNewContext(fs.readFileSync(path.join(root, 'dist/assets/js/layout.js'), 'utf8'), {
      Worker: class {
        constructor(url: string) {
          urls.push(url);
        }
      },
    });
    expect(urls).toEqual([expect.stringMatching(/^\/site\/assets\/js\/layout-worker\.min\.0x[\w-]+\.js$/)]);
    const messages: string[] = [];

    runInNewContext(fs.readFileSync(path.join(root, 'dist', urls[0]!.slice('/site/'.length)), 'utf8'), {
      self: { postMessage: (message: string) => messages.push(message) },
    });
    expect(messages).toEqual(['layout ready']);
  });

  const resolveBase = async (config: object): Promise<string> =>
    (await resolveConfig({ ...config, configFile: false, logLevel: 'silent' }, 'serve', 'development')).base;

  it('emits identical static files, including public copies and worker maps, from LF and CRLF inputs', async () => {
    const scripts = path.join(root, 'src/assets/scripts');
    const assets = path.join(root, 'public/assets');
    const dist = path.join(root, 'dist');

    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(assets, { recursive: true });
    const binary = Buffer.from([255, 13, 10, 0]);

    fs.writeFileSync(path.join(assets, 'image.png'), binary);

    const compile = async (eol: string) => {
      const js = `self.postMessage("ok");${eol}`;
      const svg = `<svg>${eol}</svg>${eol}`;

      fs.writeFileSync(path.join(root, 'index.html'), `<html><body></body></html>${eol}`);
      fs.writeFileSync(path.join(scripts, 'layout.entry.ts'), `import Worker from './calc.ts?worker';${eol}new Worker();${eol}`);
      fs.writeFileSync(path.join(scripts, 'calc.ts'), js);
      fs.writeFileSync(path.join(assets, 'image.svg'), svg);
      fs.writeFileSync(path.join(assets, 'vendor.js'), js);
      fs.writeFileSync(path.join(assets, 'unicode.js'), '// ' + 'a'.repeat(4092) + 'é' + eol);
      for (const name of ['data.csv', 'sample.yaml', 'LICENSE']) fs.writeFileSync(path.join(assets, name), 'sample' + eol);
      fs.writeFileSync(path.join(assets, 'vendor.js.map'), JSON.stringify({ version: 3, sourcesContent: [js] }, null, 2).replaceAll('\n', eol) + eol);
      fs.rmSync(dist, { recursive: true, force: true });
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, 'unowned.txt'), 'retain\r\n');

      await build({ ...defineAlveoConfig({ root, build: { emptyOutDir: false } }), configFile: false, logLevel: 'error' });
      expect(fs.readFileSync(path.join(assets, 'image.svg'), 'utf8')).toBe(svg);
      expect(fs.readFileSync(path.join(dist, 'assets/image.svg'), 'utf8')).toBe('<svg>\n</svg>\n');
      expect(fs.readFileSync(path.join(dist, 'assets/image.png'))).toEqual(binary);
      for (const name of ['data.csv', 'sample.yaml', 'LICENSE']) expect(fs.readFileSync(path.join(dist, 'assets', name), 'utf8')).toBe('sample\n');
      expect(fs.readFileSync(path.join(dist, 'unowned.txt'), 'utf8')).toBe('retain\r\n');

      return Object.fromEntries(
        fs
          .readdirSync(dist, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const file = path.join(entry.parentPath, entry.name);

            return [path.relative(dist, file), fs.readFileSync(file).toString('base64')];
          })
      );
    };

    const lf = await compile('\n');
    const crlf = await compile('\r\n');

    expect(Object.keys(crlf).sort()).toEqual(Object.keys(lf).sort());
    for (const name of Object.keys(lf)) expect(crlf[name], name).toBe(lf[name]);
  });

  it('uses the mode environment base only as a default', async () => {
    expect(await resolveBase(defineAlveoConfig({ root }))).toBe('/env/');
  });

  it('prefers defineAlveoConfig({ base }) over the environment', async () => {
    expect(await resolveBase(defineAlveoConfig({ root, base: '/config/' }))).toBe('/config/');
  });

  it('keeps an explicit inline/CLI base over both config and environment', async () => {
    // Vite merges inline config (including `--base`) over the config file
    // before plugin hooks run; mergeConfig reproduces that ordering.
    expect(await resolveBase(mergeConfig(defineAlveoConfig({ root }), { base: '/cli/' }))).toBe('/cli/');
    expect(await resolveBase(mergeConfig(defineAlveoConfig({ root, base: '/config/' }), { base: '/cli/' }))).toBe('/cli/');
  });

  it('falls back to the site root without an environment base', async () => {
    fs.rmSync(path.join(root, '.env'));
    expect(await resolveBase(defineAlveoConfig({ root }))).toBe('/');
  });
});
