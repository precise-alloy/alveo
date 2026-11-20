// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prerender } from './prerender.ts';

const roots: string[] = [];
const fixture = (fail = false) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-prerender-'));

  roots.push(root);
  fs.mkdirSync(path.join(root, 'dist/server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, '.env'), 'VITE_BASE_URL=/subpath/\n');
  fs.writeFileSync(
    path.join(root, 'dist/static/index.html'),
    '<html><head><title>x</title><style>/* app-styles */</style></head><body><!--app-html--></body></html>'
  );
  fs.writeFileSync(
    path.join(root, 'dist/server/entry-server.js'),
    `
    export const renderConfig = { baseUrl: '/subpath/', pathExtension: '' };
    export const routesToPrerender = [{route:'/pages/first',name:'First'}, {route:'/pages/second',name:'Second'}];
    export async function render(url) {
      if (${fail} && url.includes('first')) throw new Error('broken component');
      return ${JSON.stringify({ html: "<p>$& $$ $` $'</p>", styles: '/* $& $$ */' })};
    }`
  );

  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe('prerender orchestration', () => {
  it('reports an outdated SSR bundle instead of guessing a base URL', async () => {
    const root = fixture();

    fs.writeFileSync(path.join(root, 'dist/server/entry-server.js'), 'export const render = () => ({});');
    await expect(prerender(root, { mode: 'production' })).rejects.toThrow('resolved render configuration');
  });
  it('awaits renders and preserves literal dollar patterns in persisted HTML and styles', async () => {
    const root = fixture();

    expect(await prerender(root, { mode: 'production' })).toEqual({ missing: [] });
    const html = fs.readFileSync(path.join(root, 'dist/static/pages/first.html'), 'utf8');

    expect(html).toContain("$&amp; $$ $` $'");
    expect(html).toContain('/* $& $$ */');
    expect(html).not.toContain('<!--app-html-->');
    expect(html).not.toContain('\r');
  });
  it('stops on the first failed route without writing blank pages or later routes', async () => {
    const root = fixture(true);

    await expect(prerender(root, { mode: 'production' })).rejects.toThrow('broken component');
    expect(fs.existsSync(path.join(root, 'dist/static/pages/first.html'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'dist/static/pages/second.html'))).toBe(false);
  });
});
