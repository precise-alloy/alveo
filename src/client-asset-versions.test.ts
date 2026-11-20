// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { clientAssetVersionsJson } from './client-asset-versions.ts';
import { getAssetVersion } from './cryptography.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alveo-client-versions-'));
const assets = path.join(root, 'assets');

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('indexes only stable shipped CSS and JS, using canonical bytes and portable, base-independent keys', () => {
  expect(clientAssetVersionsJson(assets)).toBe('{}');
  fs.mkdirSync(path.join(assets, 'css/nested'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'css/nested/widget.css'), 'a{}\r\n');
  fs.writeFileSync(path.join(assets, 'css/nested/widget.css.map'), '{}');
  expect(JSON.parse(clientAssetVersionsJson(assets))).toEqual({ '/assets/css/nested/widget.css': getAssetVersion('a{}\n') });
  fs.mkdirSync(path.join(assets, 'js'));
  fs.mkdirSync(path.join(assets, 'vendors'));
  fs.writeFileSync(path.join(assets, 'js/component.js'), 'final bytes');
  fs.writeFileSync(path.join(assets, 'js/lazy.0x12345678.js'), 'lazy');
  fs.writeFileSync(path.join(assets, 'vendors/vendor.css'), 'vendor');
  expect(JSON.parse(clientAssetVersionsJson(assets))).toEqual({
    '/assets/css/nested/widget.css': getAssetVersion('a{}\n'),
    '/assets/js/component.js': getAssetVersion('final bytes'),
  });
});
