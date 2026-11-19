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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-config-base-'));
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
