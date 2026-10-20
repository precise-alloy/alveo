type RuntimeGlobal = typeof globalThis & {
  getModifiers?: (model: BasedAtomicModel, baseClass: string) => string;
  viteAbsoluteUrl?: (path: string, addExtension?: boolean) => string;
  getCookie?: (name: string) => string | undefined;
};

const runtimeGlobal = globalThis as RuntimeGlobal;
// SSR needs the helpers, not a fake DOM. Synthesizing window defeats browser
// guards in consumer components and third-party libraries.
const runtimeWindow = typeof window !== 'undefined' ? window : runtimeGlobal;

runtimeGlobal.getModifiers = (model: BasedAtomicModel, baseClass: string) => {
  const classes = [baseClass];

  model.globalModifier?.forEach((m) => classes.push(m));
  model.styleModifier?.forEach((m) => classes.push(baseClass + '--' + m));

  if (model.theme) {
    classes.push('theme-' + model.theme);
  }

  return classes.join(' ');
};

runtimeGlobal.viteAbsoluteUrl = (path: string, addExtension = false): string => {
  if (/^https?:\/\//gi.test(path)) {
    return path;
  }
  const baseUrl = import.meta.env.BASE_URL;
  const normalizedRemain =
    (path?.startsWith('/') ? path : '/' + path) + (addExtension && !path.endsWith('/') ? (import.meta.env.VITE_PATH_EXTENSION ?? '') : '');

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
