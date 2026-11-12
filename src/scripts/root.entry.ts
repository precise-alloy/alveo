import {
  MIN_FRAME_SIZE,
  MSG_IFRAME_SIZE,
  applyFrameWidth,
  getAppliedFrameWidth,
  getFrameWrapper,
  getMaxFrameWidth,
  persistFrameWidth,
  revalidateFrameWidth,
} from '../root/frame-width.ts';

const BORDER_SIZE = 20;
const MSG_IS_TOP_PANEL = 'MSG_IS_TOP_PANEL';

let orgWidth: number;
let pos: number;
let iframeSize: number | undefined;
let maxWidth: number | undefined;
let revalidateFrame = 0;

const getWrapper = getFrameWrapper;
const getFrame = () => document.getElementById('root-iframe');
const getFrameBackdrop = () => document.getElementById('root-iframe-backdrop');
const getResizer = () => document.getElementById('root-iframe-resizer');

const setIFrameWidth = (width?: number, maxWidth?: number) => {
  const wrapper = getWrapper();

  return wrapper ? applyFrameWidth(wrapper, width, maxWidth) : undefined;
};

/**
 * Re-checks the applied width once per frame after the available space
 * changes. Deferring to rAF keeps style writes out of ResizeObserver callbacks
 * (avoiding "ResizeObserver loop" errors) and coalesces bursts of viewport
 * resize notifications into one layout read.
 */
const scheduleRevalidate = () => {
  if (revalidateFrame) {
    return;
  }

  revalidateFrame = requestAnimationFrame(() => {
    revalidateFrame = 0;
    const wrapper = getWrapper();

    if (wrapper) {
      revalidateFrameWidth(wrapper);
    }
  });
};

const resize = (e: globalThis.MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
  const dx = (e.x - pos) * 2;

  const size = Math.max(MIN_FRAME_SIZE, orgWidth + dx);

  // Dragging past the available space snaps to Full Width; dragging back
  // re-applies a constrained width from the original mousedown width.
  iframeSize = setIFrameWidth(size, maxWidth);

  return false;
};

const mouseUp = () => {
  const wrapper = getWrapper();
  const frame = getFrame();
  const frameBackdrop = getFrameBackdrop();

  if (!wrapper || !frame || !frameBackdrop) {
    return;
  }

  wrapper.style.removeProperty('transition');
  frameBackdrop.style.removeProperty('display');
  persistFrameWidth(iframeSize);

  document.removeEventListener('mousemove', resize, false);
  document.removeEventListener('mouseup', mouseUp, false);
};

const handleResizerMouseDown = (e: MouseEvent) => {
  const wrapper = getWrapper();
  const frame = getFrame();
  const frameBackdrop = getFrameBackdrop();

  if (!wrapper || !frame || !frameBackdrop || e.offsetX >= BORDER_SIZE) {
    return;
  }

  wrapper.style.transition = 'none';
  frameBackdrop.style.display = 'block';
  pos = e.x;
  orgWidth = parseFloat(getComputedStyle(wrapper, '').width);
  // Frame-control buttons may have changed the width since load; start from it.
  iframeSize = getAppliedFrameWidth(wrapper);
  // The available space cannot change mid-drag; measure it once here so each
  // mousemove only writes styles.
  maxWidth = getMaxFrameWidth(wrapper);
  document.addEventListener('mousemove', resize, false);
  document.addEventListener('mouseup', mouseUp, false);
};

const initTopPanel = () => {
  const isTopPanel = localStorage.getItem(MSG_IS_TOP_PANEL) === 'true';
  const rootEl = document.querySelector('.alveo-t-root');

  if (!rootEl) {
    return;
  }
  if (isTopPanel) {
    rootEl.classList.add('top-panel');
  }
};

const handleStoreModified = (event: StorageEvent) => {
  switch (event.key) {
    case MSG_IS_TOP_PANEL: {
      const isTopPanel = event.newValue === 'true';
      const rootEl = document.querySelector('.alveo-t-root');

      if (!rootEl) {
        return;
      }

      if (isTopPanel) {
        rootEl.classList.add('top-panel');
      } else {
        rootEl.classList.remove('top-panel');
      }
      // Moving the panel beside the preview shrinks its cell without resizing
      // the root, so the observers may not fire; re-check explicitly.
      scheduleRevalidate();
      break;
    }
  }
};

const addStoreEvent = () => {
  window.addEventListener('storage', handleStoreModified);
};

const setup = () => {
  const resizer = getResizer();
  const frame = getFrame();

  if (!resizer || !frame) {
    return;
  }

  resizer.onmousedown = handleResizerMouseDown;
  // Apply the panel layout first so the restored width is checked against the
  // real preview cell. A width saved in a larger window (sessionStorage
  // survives browser session restore) that no longer fits switches to Full
  // Width and is cleared instead of overflowing the page.
  initTopPanel();
  persistFrameWidth(setIFrameWidth(parseInt(sessionStorage.getItem(MSG_IFRAME_SIZE) ?? '', 10) || undefined));

  const getIFrameActualWidth = () => {
    const el = document.getElementById('root-actual-iframe-width');

    if (el) {
      el.textContent = `${Math.ceil(parseFloat(getComputedStyle(frame).width))}px`;
    }
  };

  frame.onload = getIFrameActualWidth;

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(() => {
      getIFrameActualWidth();
      scheduleRevalidate();
    });

    resizeObserver.observe(frame);

    // The root grid tracks the viewport; observing it catches window shrinks
    // that leave the frame size unchanged but remove the handle's spare room.
    const rootEl = getWrapper()?.parentElement;

    if (rootEl) {
      resizeObserver.observe(rootEl);
    }
  }
  addStoreEvent();

  const wrapper = getWrapper();

  if (wrapper) {
    window.addEventListener('load', () => wrapper.classList.add('initialized'));
  }
};

setup();

export {};
