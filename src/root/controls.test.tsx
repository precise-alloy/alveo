import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FrameControls from './frame-controls.tsx';
import ActiveItemOptions from './active-item-options.tsx';
import Root from './index.tsx';
import { RootContext, type RootData } from './root-context.ts';

const data = (overrides: Partial<RootData> = {}): RootData => ({
  activeItem: { type: 'single', name: 'About', path: '/pages/about' },
  setActiveItem: vi.fn(),
  setTopPanel: vi.fn(),
  setRtl: vi.fn(),
  isTopPanel: false,
  isRtl: false,
  ...overrides,
});
const settings = (value: RootData) => (
  <RootContext.Provider value={value}>
    <ActiveItemOptions />
  </RootContext.Provider>
);

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('viteAbsoluteUrl', (value: string, extension = false) => '/subpath' + value + (extension ? '.html' : ''));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('dir');
});

describe('frame controls', () => {
  const expectNoTimers = () => {
    // jsdom schedules storage-event delivery on zero-delay timers. Flush those
    // without advancing a live Disco interval before asserting its cleanup.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(vi.getTimerCount()).toBe(0);
  };

  it.each(['ltr', 'rtl'])('supports repeated Disco toggles, all widths and print cleanup in %s', (direction) => {
    document.documentElement.dir = direction;
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root-iframe-wrapper"></div>';
    const { unmount } = render(<FrameControls />);
    const disco = screen.getByRole('button', { name: 'Disco Mode View' });
    const wrapper = document.getElementById('root-iframe-wrapper')!;

    fireEvent.click(disco);
    expect(disco).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(wrapper.style.maxWidth).toContain('min(100%,');
    fireEvent.click(disco);
    expect(disco).toHaveAttribute('aria-pressed', 'false');
    expectNoTimers();
    fireEvent.click(disco);
    fireEvent(window, new Event('beforeprint'));
    expect(disco).toHaveAttribute('aria-pressed', 'false');
    expectNoTimers();
    for (const name of ['Mobile View', 'Tablet View', 'Desktop View', 'Random Width View']) {
      fireEvent.click(disco);
      fireEvent.click(screen.getByRole('button', { name }));
      expectNoTimers();
      expect(sessionStorage.getItem('MSG_IFRAME_SIZE')).not.toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Full Width View' }));
    expect(wrapper.style.maxWidth).toBe('');
    expect(sessionStorage.getItem('MSG_IFRAME_SIZE')).toBeNull();
    fireEvent.click(disco);
    unmount();
    expectNoTimers();
  });
  it('tolerates a missing frame without leaving a timer behind', () => {
    const { unmount } = render(<FrameControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Mobile View' }));
    unmount();
  });
});

describe('active item settings', () => {
  it('keeps outside-click subscriptions stable across rerenders and exposes keyboard/ARIA state', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const view = render(settings(data()));

    view.rerender(settings(data({ isRtl: true })));
    expect(add.mock.calls.filter(([event]) => event === 'mousedown')).toHaveLength(1);
    expect(document.getElementById('alveo-settings')).not.toHaveAttribute('aria-hidden');
    expect(document.getElementById('alveo-settings')).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const button = screen.getByRole('button', { name: 'Close' });

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('alveo-settings')).not.toHaveAttribute('inert');
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const icon = view.container.querySelector('use');

    expect(icon?.getAttribute('href')).toContain('/src/assets/root.svg#setting');
  });
  it.each([false, true])('updates state, RTL, panel and theme settings from existing state %s', (enabled) => {
    if (enabled) localStorage.setItem('pl-show-state-selector', 'true');
    const reload = vi.fn();

    vi.stubGlobal('location', { reload });
    const dispatch = vi.spyOn(window, 'dispatchEvent');

    render(settings(data({ isRtl: enabled, isTopPanel: enabled })));
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    open();
    fireEvent.click(screen.getByRole('button', { name: enabled ? 'Hide state selector' : 'Show state selector' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem('pl-show-state-selector')).toBe(enabled ? null : 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Change theme' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'toggleTheme' }));
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', '/subpath/pages/about.html');
    fireEvent.click(screen.getByRole('button', { name: enabled ? 'Disable RTL' : 'Enable RTL' }));
    expect(localStorage.getItem('MSG_IS_RTL')).toBe(enabled ? 'false' : 'true');
    open();
    fireEvent.click(screen.getByRole('button', { name: enabled ? 'Set side panel' : 'Set top panel' }));
    expect(localStorage.getItem('MSG_IS_TOP_PANEL')).toBe(enabled ? 'false' : 'true');
  });
  it('handles clearing the active item while the menu is open', () => {
    const view = render(settings(data()));

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    view.rerender(settings(data({ activeItem: undefined })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.container.textContent).toBe('');
  });
});

describe('catalog without an assumed home route', () => {
  it('selects a real page rather than recursively loading the catalog', () => {
    document.body.innerHTML = '<iframe id="root-iframe"></iframe>';
    render(
      <Root
        routes={[
          { type: 'single', path: '/', name: 'Root' },
          { type: 'single', path: '/atoms/button', name: 'Button' },
          { type: 'single', path: '/pages/about', name: 'About' },
        ]}
      />
    );
    expect(document.querySelector('iframe')).toHaveAttribute('src', '/subpath/pages/about.html');
  });
  it('shows an explicit empty state when only the catalog exists', () => {
    render(<Root routes={[{ type: 'single', path: '/', name: 'Root' }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No pages or components');
  });
});
