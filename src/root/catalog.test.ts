import type { SinglePageNode } from './models.ts';

import { describe, expect, it } from 'vitest';

import { getCatalogRoutes, getInitialCatalogRoute } from './catalog.ts';

const node = (path: string): SinglePageNode => ({ path, name: path, type: 'single' });

describe('catalog route selection', () => {
  it('flattens collections and excludes self-recursive catalog routes', () => {
    expect(
      getCatalogRoutes([
        node('/'),
        node('/index'),
        node('/pages/a'),
        {
          type: 'collection',
          name: 'Atoms',
          path: undefined,
          items: [node('/atoms/b')],
        },
      ])
    ).toEqual([node('/pages/a'), node('/atoms/b')]);
  });
  it('prefers a valid hash, home, first page, then first component', () => {
    const routes = [node('/atoms/button'), node('/pages/a'), node('/pages/home')];

    expect(getInitialCatalogRoute(routes, '#/pages/a')).toBe(routes[1]);
    expect(getInitialCatalogRoute(routes, '#/missing')).toBe(routes[2]);
    expect(getInitialCatalogRoute(routes.slice(0, 2), '')).toBe(routes[1]);
    expect(getInitialCatalogRoute(routes.slice(0, 1), 'other')).toBe(routes[0]);
    expect(getInitialCatalogRoute([], '')).toBeUndefined();
  });
});
