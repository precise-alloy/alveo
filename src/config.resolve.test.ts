// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { build, mergeConfig, resolveConfig } from 'vite';

import { defineAlveoConfig } from './config.ts';
import { getAssetVersion } from './cryptography.ts';

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

  it.each([undefined, 'post'] as const)('canonicalizes a late consumer asset before returning the bundle (hook order: %s)', async (order) => {
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const text = 'late notice\n';
    const fileName = `assets/notice.0x${getAssetVersion(text)}.txt`;

    for (const source of [text, 'late notice\r\n']) {
      const output = await build({
        ...defineAlveoConfig({
          root,
          build: { write: false },
          plugins: [
            {
              name: 'late-notice',
              enforce: 'post',
              generateBundle: {
                order,
                handler() {
                  this.emitFile({ type: 'asset', name: 'notice.txt', source });
                },
              },
            },
          ],
        }),
        configFile: false,
        logLevel: 'error',
      });

      if (!('output' in output)) throw new Error('Expected a single in-memory bundle');
      const notice = output.output.find((item) => item.fileName === fileName);

      expect(notice?.type === 'asset' && Buffer.from(notice.source)).toEqual(Buffer.from(text));
    }
  });

  it.each([
    { name: 'plugin-icon.svg', prefix: 'assets/images/plugin-icon', ext: '.svg', text: '<svg>\n<circle/>\n</svg>\n', write: true },
    { name: 'notice.txt', prefix: 'assets/notice', ext: '.txt', text: 'one\ntwo\n', write: false },
  ])('uses the same $name bytes and importer URL across line endings and source representations', async ({ name, prefix, ext, text, write }) => {
    fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
    fs.writeFileSync(path.join(root, 'main.js'), 'import url from "virtual:fixture-asset"; console.log(url);');

    const compile = async (source: string | Buffer) => {
      const output = await build({
        ...defineAlveoConfig({
          root,
          build: { write, modulePreload: { polyfill: false } },
          plugins: [
            {
              name: 'fixture-text-asset',
              resolveId(id) {
                if (id === 'virtual:fixture-asset') return '\0fixture-asset';
              },
              load(id) {
                if (id !== '\0fixture-asset') return;
                const ref = this.emitFile({ type: 'asset', name, source });

                return `export default import.meta.ROLLDOWN_FILE_URL_${ref};`;
              },
            },
          ],
        }),
        configFile: false,
        logLevel: 'error',
      });

      if (!('output' in output)) throw new Error('Expected a single bundle');
      const asset = output.output.find((item) => item.type === 'asset' && item.names.includes(name));

      if (asset?.type !== 'asset') throw new Error(`Missing plugin asset: ${name}`);
      const importer = output.output.find((item) => item.type === 'chunk' && item.name === 'index');

      if (importer?.type !== 'chunk') throw new Error('Expected the HTML entry chunk');
      const urls: string[] = [];

      runInNewContext(importer.code, { console: { log: (url: string) => urls.push(url) } });

      return {
        file: asset.fileName,
        bundle: Buffer.from(asset.source).toString('utf8'),
        disk: write ? fs.readFileSync(path.join(root, 'dist', asset.fileName), 'utf8') : undefined,
        urls,
      };
    };

    const crlf = text.replaceAll('\n', '\r\n');
    const lf = await compile(text);
    const file = `${prefix}.0x${getAssetVersion(text)}${ext}`;

    expect(await compile(crlf)).toEqual(lf);
    expect(await compile(Buffer.from(crlf))).toEqual(lf);
    expect(lf).toEqual({ file, bundle: text, disk: write ? text : undefined, urls: [`/env/${file}`] });
    expect((await compile(text + '\n')).file).not.toBe(lf.file);
  });

  it('canonicalizes emitted maps without walking an overlapping public tree', async () => {
    const publicDir = path.join(root, 'public');
    const outDir = path.join(publicDir, 'dist');
    const raw = 'line one\r\nline two\r\n';
    const map = JSON.stringify({ version: 3, sources: ['input.ts'], sourcesContent: [raw] }, null, 2);
    const scripts = path.join(root, 'src/assets/scripts');

    fs.mkdirSync(publicDir);
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'layout.entry.ts'), "import Worker from './calc.ts?worker';\r\nnew Worker();\r\n");
    fs.writeFileSync(path.join(scripts, 'calc.ts'), 'self.postMessage("ok");\r\n');
    fs.writeFileSync(path.join(publicDir, 'keep.txt'), raw);
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const output = await build({
      ...defineAlveoConfig({
        root,
        build: { outDir, emptyOutDir: false },
        plugins: [
          {
            name: 'fixture-map',
            buildStart() {
              this.emitFile({ type: 'asset', fileName: 'generated.js.map', source: map });
              this.emitFile({ type: 'asset', name: 'named.map', source: map });
            },
          },
        ],
      }),
      configFile: false,
      logLevel: 'error',
    });

    if (!('output' in output)) throw new Error('Expected a single bundle');
    const asset = output.output.find((item) => item.fileName === 'generated.js.map');
    const expected = JSON.stringify({ version: 3, sources: ['input.ts'], sourcesContent: ['line one\nline two\n'] });

    expect(asset?.type === 'asset' && asset.source).toBe(expected);
    expect(fs.readFileSync(path.join(outDir, 'generated.js.map'), 'utf8')).toBe(expected);
    expect(fs.readFileSync(path.join(outDir, `assets/named.0x${getAssetVersion(expected)}.map`), 'utf8')).toBe(expected);
    const workerMap = fs.readdirSync(path.join(outDir, 'assets/js')).find((file) => /^calc\.0x[\w-]+\.js\.map$/.test(file));

    expect(JSON.parse(fs.readFileSync(path.join(outDir, 'assets/js', workerMap!), 'utf8')).sourcesContent).toContain('self.postMessage("ok");\n');
    expect(fs.readFileSync(path.join(publicDir, 'keep.txt'), 'utf8')).toBe(raw);
  });

  it('emits unnamed text matching its canonical fingerprint without reclassifying explicit opaque files', async () => {
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const bytes = Buffer.from('one\r\ntwo\r\n');
    const expected = 'one\ntwo\n';
    const output = await build({
      ...defineAlveoConfig({
        root,
        build: { write: false },
        plugins: [
          {
            name: 'fixture-assets',
            buildStart() {
              this.emitFile({ type: 'asset', source: bytes });
              this.emitFile({ type: 'asset', source: Buffer.from('one\rtwo\r') });
              this.emitFile({ type: 'asset', fileName: 'opaque.bin', source: bytes });
              this.emitFile({ type: 'asset', fileName: 'assets/asset.0xexample', source: bytes });
            },
          },
        ],
      }),
      configFile: false,
      logLevel: 'error',
    });

    if (!('output' in output)) throw new Error('Expected a single in-memory bundle');
    const assets = Object.fromEntries(output.output.filter((item) => item.type === 'asset').map((item) => [item.fileName, Buffer.from(item.source)]));

    expect(assets[`assets/asset.0x${getAssetVersion(expected)}`]).toEqual(Buffer.from(expected));
    expect(assets[`assets/asset2.0x${getAssetVersion(expected)}`]).toEqual(Buffer.from(expected));
    expect(assets['assets/asset.0xexample']).toEqual(bytes);
    expect(assets['opaque.bin']).toEqual(bytes);
  });

  it.each([false, 'oxc'] as const)('emits identical static files from LF and CRLF inputs (minify: %s)', async (minify) => {
    const scripts = path.join(root, 'src/assets/scripts');
    const assets = path.join(root, 'public/assets');
    const dist = path.join(root, 'dist');

    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(assets, { recursive: true });
    const binary = Buffer.from([255, 13, 10, 0]);

    fs.writeFileSync(path.join(assets, 'image.png'), binary);

    const compile = async (eol: string) => {
      const js = `/*! worker${eol}license */${eol}self.postMessage(\`first${eol}second\`);${eol}`;
      const svg = `<svg>${eol}</svg>${eol}`;

      fs.writeFileSync(path.join(root, 'index.html'), `<html><body><script type="module">console.log(42)</script></body></html>${eol}`);
      fs.writeFileSync(
        path.join(scripts, 'layout.entry.ts'),
        `import Worker from './calc.ts?worker';${eol}import icon from './logo.svg?url';${eol}console.log(icon);new Worker();${eol}`
      );
      fs.writeFileSync(path.join(scripts, 'logo.svg'), svg);
      fs.writeFileSync(path.join(scripts, 'calc.ts'), js);
      fs.writeFileSync(path.join(assets, 'image.svg'), svg);
      fs.writeFileSync(path.join(assets, 'vendor.js'), js);
      fs.writeFileSync(path.join(assets, 'unicode.js'), '// ' + 'a'.repeat(4092) + 'é' + eol);
      for (const name of ['data.csv', 'sample.yaml', 'LICENSE']) fs.writeFileSync(path.join(assets, name), 'sample' + eol);
      fs.mkdirSync(path.join(assets, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(assets, 'pages/sample.cshtml'), `@model Page${eol}<h1>@Model.Title</h1>${eol}`);
      fs.writeFileSync(path.join(assets, 'vendor.js.map'), JSON.stringify({ version: 3, sourcesContent: [js] }, null, 2).replaceAll('\n', eol) + eol);
      fs.rmSync(dist, { recursive: true, force: true });
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, 'unowned.txt'), 'retain\r\n');

      const output = await build({
        ...defineAlveoConfig({
          root,
          build: { minify, emptyOutDir: false, assetsInlineLimit: 0 },
          plugins: [
            {
              name: 'fixture-license',
              enforce: 'post',
              renderChunk(code) {
                return { code: code + `\n/*! consumer${eol}license */`, map: null };
              },
            },
          ],
        }),
        configFile: false,
        logLevel: 'error',
      });
      const [icon] = fs.readdirSync(path.join(dist, 'assets/images')).filter((name) => /^logo\.0x[\w-]+\.svg$/.test(name));

      const asset = 'output' in output && output.output.find((item) => item.fileName === `assets/images/${icon}`);

      expect(asset && asset.type === 'asset' && asset.source).toBe('<svg>\n</svg>\n');
      if (!('output' in output)) throw new Error('Expected a single written bundle');
      const main = output.output.find((item) => item.type === 'chunk' && item.name === 'index');

      if (!minify) expect(main?.type === 'chunk' && main.code).toContain('/*! consumer\nlicense */');
      for (const item of output.output.filter((entry) => entry.fileName.endsWith('.js'))) {
        expect(fs.readFileSync(path.join(dist, item.fileName))).toEqual(Buffer.from(item.type === 'chunk' ? item.code : item.source));
      }
      expect(fs.readFileSync(path.join(dist, 'assets/js/layout.js'), 'utf8')).toContain(icon);
      expect(fs.readFileSync(path.join(dist, 'assets/images', icon!), 'utf8')).toBe('<svg>\n</svg>\n');
      expect(fs.readFileSync(path.join(assets, 'image.svg'), 'utf8')).toBe(svg);
      expect(fs.readFileSync(path.join(dist, 'assets/image.svg'), 'utf8')).toBe('<svg>\n</svg>\n');
      expect(fs.readFileSync(path.join(dist, 'assets/image.png'))).toEqual(binary);
      for (const name of ['data.csv', 'sample.yaml', 'LICENSE']) expect(fs.readFileSync(path.join(dist, 'assets', name), 'utf8')).toBe('sample\n');
      expect(fs.readFileSync(path.join(dist, 'assets/pages/sample.cshtml'), 'utf8')).toBe('@model Page\n<h1>@Model.Title</h1>\n');
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
