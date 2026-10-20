import type { RootItemModel, SinglePageNode } from './models.ts';

export function getCatalogRoutes(routes: RootItemModel[]): SinglePageNode[] {
  // The catalog's own root must never become its iframe fallback, otherwise a
  // project without pages recursively embeds the catalog inside itself.
  return routes
    .flatMap((route) => (route.type === 'single' ? [route] : route.items))
    .filter((route) => route.path !== '/' && route.path !== '/index')
    .map(({ path, name }) => ({ path, name, type: 'single' }));
}

export function getInitialCatalogRoute(routes: SinglePageNode[], hash: string): SinglePageNode | undefined {
  const selectedPath = hash.startsWith('#/') ? hash.slice(1) : '';

  return (
    routes.find((route) => route.path === selectedPath) ??
    routes.find((route) => route.path === '/pages/home') ??
    routes.find((route) => route.path.startsWith('/pages/')) ??
    routes[0]
  );
}
