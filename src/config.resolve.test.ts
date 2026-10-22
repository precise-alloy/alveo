// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeConfig, resolveConfig } from 'vite';

import { defineAlveoConfig } from './config.ts';

// Exercises the real Vite config pipeline (inline merge + plugin `config`
// hooks) so base precedence is proven end to end, not only via a mocked hook.
describe('Alveo base precedence through Vite resolveConfig', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-config-base-'));
    fs.writeFileSync(path.join(root, '.env'), 'VITE_BASE_URL=/env/\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
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
