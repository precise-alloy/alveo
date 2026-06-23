// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { getAssetVersion, getAssetHash, getMetadata } from './cryptography.js';

describe('alveo/cryptography.ts', () => {
  describe('getAssetVersion', () => {
    it('returns a 10-character base64url string', () => {
      const version = getAssetVersion('hello world');

      expect(version).toHaveLength(10);
      expect(version).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('returns the same version for the same content', () => {
      expect(getAssetVersion('test content')).toBe(getAssetVersion('test content'));
    });

    it('returns different versions for different content', () => {
      expect(getAssetVersion('content A')).not.toBe(getAssetVersion('content B'));
    });

    it('accepts Buffer input', () => {
      const version = getAssetVersion(Buffer.from('hello'));

      expect(version).toHaveLength(10);
      expect(version).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces the same hash for equivalent string and Buffer inputs', () => {
      const text = 'same content';

      expect(getAssetVersion(text)).toBe(getAssetVersion(Buffer.from(text)));
    });
  });

  describe('getAssetHash', () => {
    it('returns a base64-encoded SHA-384 digest', () => {
      const hash = getAssetHash('hello world');

      // SHA-384 produces 48 bytes, base64 encodes to 64 characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('returns the same hash for the same content', () => {
      expect(getAssetHash('test content')).toBe(getAssetHash('test content'));
    });

    it('returns different hashes for different content', () => {
      expect(getAssetHash('content A')).not.toBe(getAssetHash('content B'));
    });

    it('accepts Buffer input', () => {
      const hash = getAssetHash(Buffer.from('hello'));

      expect(hash).toHaveLength(64);
    });
  });

  describe('getMetadata', () => {
    it('returns version and integrity for normal filenames', () => {
      const metadata = getMetadata('hello world', 'style.css');

      expect(metadata.version).toBeDefined();
      expect(metadata.version).toHaveLength(10);
      expect(metadata.integrity).toMatch(/^sha384-/);
    });

    it('skips version for filenames with content hash pattern .0x[hash].ext', () => {
      const metadata = getMetadata('hello world', 'style.0xabcdef12.css');

      expect(metadata.version).toBeUndefined();
      expect(metadata.integrity).toMatch(/^sha384-/);
    });

    it('skips version for various valid content hash patterns', () => {
      expect(getMetadata('x', 'app.0x12345678.js').version).toBeUndefined();
      expect(getMetadata('x', 'bundle.0xabcdefabcd.css').version).toBeUndefined();
      expect(getMetadata('x', 'chunk.0x1a2b3c4d5e6f.js').version).toBeUndefined();
    });

    it('includes version when filename does not match hash pattern', () => {
      expect(getMetadata('x', 'style.css').version).toBeDefined();
      expect(getMetadata('x', 'app.bundle.js').version).toBeDefined();
      expect(getMetadata('x', 'file.0x.css').version).toBeDefined(); // too short hash
    });

    it('computes integrity as sha384- prefix plus base64 hash', () => {
      const content = 'test content';
      const metadata = getMetadata(content, 'file.css');
      const expectedHash = getAssetHash(content);

      expect(metadata.integrity).toBe('sha384-' + expectedHash);
    });
  });
});
