import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRAME_CONSTRAINED_CLASS,
  MSG_IFRAME_SIZE,
  applyFrameWidth,
  getAppliedFrameWidth,
  getFrameWrapper,
  getMaxFrameWidth,
  persistFrameWidth,
  revalidateFrameWidth,
} from './frame-width.ts';

// Mirrors the root template: the wrapper is the last item of the root grid and
// owns the drag handle that sits 1px outside its inline-end edge.
const mount = (columns = '300px 1000px', resizerWidth = '20px') => {
  document.body.innerHTML = `
    <main id="root" style="grid-template-columns: ${columns}">
      <div id="root-iframe-wrapper"><div id="root-iframe-resizer" style="width: ${resizerWidth}"></div></div>
    </main>`;

  return getFrameWrapper()!;
};

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('frame width', () => {
  it('finds the wrapper and derives the largest width whose centered handle still fits', () => {
    expect(getFrameWrapper()).toBeNull();
    // 1000px cell minus (20px handle + 1px offset) on both sides of the centered wrapper.
    expect(getMaxFrameWidth(mount())).toBe(958);
    // Hidden handles still report their computed rem size.
    expect(getMaxFrameWidth(mount('300px 1000px', '1.25rem'))).toBe(958);
  });

  it('falls back to the container width without explicit tracks and tolerates a missing handle or parent', () => {
    const wrapper = mount('none');

    Object.defineProperty(wrapper.parentElement!, 'clientWidth', { configurable: true, value: 800 });
    expect(getMaxFrameWidth(wrapper)).toBe(758);

    wrapper.querySelector('#root-iframe-resizer')!.setAttribute('style', 'width: auto');
    expect(getMaxFrameWidth(wrapper)).toBe(798);

    wrapper.replaceChildren();
    expect(getMaxFrameWidth(wrapper)).toBe(798);

    expect(getMaxFrameWidth(document.createElement('div'))).toBe(-2);
  });

  it('constrains fitting widths and switches oversized or missing widths to Full Width', () => {
    const wrapper = mount();

    expect(applyFrameWidth(wrapper, 958)).toBe(958);
    expect(wrapper.style.maxWidth).toBe('min(100%, 958px)');
    expect(wrapper.classList.contains(FRAME_CONSTRAINED_CLASS)).toBe(true);
    expect(getAppliedFrameWidth(wrapper)).toBe(958);

    // e.g. a 2260px width restored after reopening the browser in a smaller window.
    expect(applyFrameWidth(wrapper, 2260)).toBeUndefined();
    expect(wrapper.style.maxWidth).toBe('');
    expect(wrapper.classList.contains(FRAME_CONSTRAINED_CLASS)).toBe(false);
    expect(getAppliedFrameWidth(wrapper)).toBeUndefined();

    expect(applyFrameWidth(wrapper, 500)).toBe(500);
    expect(applyFrameWidth(wrapper, undefined)).toBeUndefined();
    expect(wrapper.style.maxWidth).toBe('');

    // A pre-measured bound (used while dragging) replaces the layout read.
    expect(applyFrameWidth(wrapper, 900, 1200)).toBe(900);
    expect(applyFrameWidth(wrapper, 900, 800)).toBeUndefined();
  });

  it('persists constrained widths and clears storage for Full Width', () => {
    persistFrameWidth(640);
    expect(sessionStorage.getItem(MSG_IFRAME_SIZE)).toBe('640');
    persistFrameWidth(undefined);
    expect(sessionStorage.getItem(MSG_IFRAME_SIZE)).toBeNull();
  });

  it('ignores invalid applied widths', () => {
    const wrapper = mount();

    wrapper.dataset.frameWidth = 'abc';
    expect(getAppliedFrameWidth(wrapper)).toBeUndefined();
    wrapper.dataset.frameWidth = '0';
    expect(getAppliedFrameWidth(wrapper)).toBeUndefined();
  });

  it('switches to Full Width when the available space shrinks below the applied width', () => {
    const wrapper = mount();

    revalidateFrameWidth(wrapper);
    expect(wrapper.style.maxWidth).toBe('');

    persistFrameWidth(applyFrameWidth(wrapper, 900));
    revalidateFrameWidth(wrapper);
    expect(wrapper.style.maxWidth).toBe('min(100%, 900px)');
    expect(sessionStorage.getItem(MSG_IFRAME_SIZE)).toBe('900');

    wrapper.parentElement!.style.gridTemplateColumns = '300px 700px';
    revalidateFrameWidth(wrapper);
    expect(wrapper.style.maxWidth).toBe('');
    expect(wrapper.classList.contains(FRAME_CONSTRAINED_CLASS)).toBe(false);
    expect(sessionStorage.getItem(MSG_IFRAME_SIZE)).toBeNull();
  });
});
