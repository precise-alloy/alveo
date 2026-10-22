export interface RequireJsProps {
  path: string;
  async?: boolean;
  defer: boolean;
  type?: 'module' | 'text/javascript';
  inplace?: boolean;
}

export function RequireJs({ path, async, defer, inplace, type }: RequireJsProps) {
  const normalizedPath = /^https?:\/\//i.test(path)
    ? path
    : path.startsWith('vendors/')
      ? viteAbsoluteUrl('/assets/' + path + '.js')
      : viteAbsoluteUrl('/assets/js/' + path + '.js');

  return <script data-pl-require async={async} data-pl-inplace={inplace} defer={defer} src={normalizedPath} type={type ?? 'module'} />;
}

export interface RequireCssProps {
  path: string;
  rel?: 'stylesheet' | 'modulepreload';
}

export function RequireCss({ path, rel }: RequireCssProps) {
  const normalizedPath = /^https?:\/\//i.test(path)
    ? path
    : path.startsWith('vendors/')
      ? viteAbsoluteUrl('/assets/' + path + '.css')
      : viteAbsoluteUrl('/assets/css/' + path + '.css');

  return <link data-pl-require href={normalizedPath} rel={rel ?? 'stylesheet'} />;
}

export interface ReactSectionProps {
  type: string;
  data: unknown;
  css?: string | string[];
}

export function ReactSection({ type, data, css }: ReactSectionProps) {
  const json = JSON.stringify(data);

  if (json === undefined) throw new TypeError('ReactSection data must be JSON-serializable.');

  // Script elements use HTML raw-text parsing, even for application/json.
  // Escaping '<' prevents </script> and <!-- breakouts while JSON.parse restores
  // the original props; HTML entities would change the serialized values.
  const payload = <script dangerouslySetInnerHTML={{ __html: json.replaceAll('<', '\\u003c') }} data-rct={type} type="application/json" />;
  const styles = !css ? [] : typeof css === 'string' ? [css] : css;

  return (
    <>
      {styles.map((path) => (
        <RequireCss key={path} path={path} />
      ))}
      {payload}
    </>
  );
}
