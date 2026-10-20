import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mount } = vi.hoisted(() => ({ mount: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./react-loader-core.tsx', () => ({ createComponentRenderer: vi.fn(() => mount) }));
vi.mock('./scripts/functions.ts', () => ({}));
vi.mock('virtual:alveo/client-components', () => ({ clientComponents: {} }));

describe('browser loader entry', () => {
  beforeEach(() => {
    vi.resetModules();
    mount.mockClear();
    document.body.innerHTML = '<script data-rct="root" type="application/json">{}</script>';
  });
  it('publishes readiness and supports initial, manual, and load-event batches', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const listeners = vi.spyOn(window, 'addEventListener');

    await import('./react-loader.tsx');
    expect(mount).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'react-loaded' }));
    await window.renderComponents();
    const listener = listeners.mock.calls.find(([event]) => event === 'load')?.[1];

    if (typeof listener !== 'function') throw new Error('Missing load listener');
    listener(new Event('load'));
    window.removeEventListener('load', listener);
    expect(mount).toHaveBeenCalledTimes(3);
  });
});
