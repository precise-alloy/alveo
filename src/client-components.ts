import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Lazy React components that the browser-side Alveo loader can select by the
 * `data-rct` value emitted in server-rendered markup.
 */
export type ClientComponents = Record<string, LazyExoticComponent<ComponentType<any>>>;