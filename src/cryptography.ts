import crypto from 'node:crypto';

export type AssetMetadataItem = {
  version?: string;
  integrity: string;
};

export type AssetMetadata = {
  [path: string]: AssetMetadataItem;
};

export const hasContentHashInFileName = (value: string): boolean => /\.0x[a-z0-9_-]{8,12}\.\w+$/i.test(value.split(/[?#]/, 1)[0]!);

export function getAssetVersion(content: Buffer | string): string {
  const sha384Hash = crypto.createHash('sha384');

  sha384Hash.update(content);

  return sha384Hash.digest('base64url').substring(0, 10);
}

export function getAssetHash(content: Buffer | string): string {
  const sha384Hash = crypto.createHash('sha384');

  sha384Hash.update(content);

  return sha384Hash.digest('base64');
}

export function getMetadata(content: Buffer | string, filename: string): AssetMetadataItem {
  const skipVersion = hasContentHashInFileName(filename);

  return {
    version: skipVersion ? undefined : getAssetVersion(content),
    integrity: 'sha384-' + getAssetHash(content),
  };
}
