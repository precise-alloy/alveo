// Module-local on purpose: a global `BasedAtomicModel` in the packaged types
// would conflict with the starter's own type alias of the same name.
export type ModifierModel = {
  globalModifier?: string[];
  styleModifier?: string[];
  theme?: string;
};

type RuntimeGlobal = typeof globalThis & {
  getModifiers?: (model: ModifierModel, baseClass: string) => string;
  viteAbsoluteUrl?: (path: string, addExtension?: boolean) => string;
  getCookie?: (name: string) => string | undefined;
};

const runtimeGlobal = globalThis as RuntimeGlobal;
// SSR needs the helpers, not a fake DOM. Synthesizing window defeats browser
// guards in consumer components and third-party libraries.
const runtimeWindow = typeof window !== 'undefined' ? window : runtimeGlobal;

runtimeGlobal.getModifiers = (model: ModifierModel, baseClass: string) => {
  const classes = [baseClass];

  model.globalModifier?.forEach((m) => classes.push(m));
  model.styleModifier?.forEach((m) => classes.push(baseClass + '--' + m));

  if (model.theme) {
    classes.push('theme-' + model.theme);
  }

  return classes.join(' ');
};

let assetVersions: Record<string, string> | undefined;

const clientAssetVersion = (pathname: string): string | undefined => {
  if (typeof document === 'undefined' || !/^\/assets\/(?:css\/[^?#]+\.css|js\/[^?#]+\.js)$/.test(pathname)) return;
  if (!assetVersions) {
    const data = document.getElementById('alveo-asset-versions');

    // Dev and legacy backend layouts need no manifest. Don't cache absence:
    // an early standalone script may run before the head has finished parsing.
    if (!data) return;
    try {
      const parsed: unknown = JSON.parse(data.textContent);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Expected an asset version map');
      assetVersions = parsed as Record<string, string>;
    } catch (error) {
      console.error('[alveo] Invalid client asset versions', error);
      assetVersions = {};
    }
  }
  const version = assetVersions[pathname];

  return typeof version === 'string' && /^[\w-]{10}$/.test(version) ? version : undefined;
};

runtimeGlobal.viteAbsoluteUrl = (path: string, addExtension = false): string => {
  if (/^(?:https?:)?\/\//i.test(path)) {
    return path;
  }
  const baseUrl = import.meta.env.BASE_URL;
  const pathname = path.startsWith('/') ? path : '/' + path;
  const version = !addExtension && clientAssetVersion(pathname);
  const normalizedRemain =
    pathname + (version ? '?v=' + version : addExtension && !path.endsWith('/') ? (import.meta.env.VITE_PATH_EXTENSION ?? '') : '');

  if (!baseUrl) {
    return normalizedRemain;
  }

  if (!baseUrl.endsWith('/')) {
    return baseUrl + normalizedRemain;
  }

  const len = baseUrl.length;

  return baseUrl.substring(0, len - 1) + normalizedRemain;
};

runtimeWindow.getCookie = (name: string) => {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const cookies: { [name: string]: string } = {};

  document.cookie.split(';').forEach((cookie) => {
    const separator = cookie.indexOf('=');

    if (separator >= 0) cookies[cookie.slice(0, separator).trim()] = cookie.slice(separator + 1);
  });

  return cookies[name];
};
