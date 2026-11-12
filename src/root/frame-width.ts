/**
 * Shared preview-width rules for the catalog root page. Both the React frame
 * controls and the standalone `root` resizer script apply widths through these
 * helpers, so a width is only ever constrained when the drag handle still fits
 * inside the preview's grid cell. Any width that would push the handle past the
 * viewport (e.g. a width restored from sessionStorage after reopening the
 * browser in a smaller window) falls back to the Full Width view instead, so
 * the root page can never overflow horizontally and cut off its start side.
 */
export const MSG_IFRAME_SIZE = 'MSG_IFRAME_SIZE';
export const MIN_FRAME_SIZE = 350;
export const FRAME_CONSTRAINED_CLASS = 'is-constrained';

// The resizer is positioned at `calc(100% + 1px)`, i.e. 1px outside the wrapper.
const RESIZER_OFFSET = 1;

export const getFrameWrapper = (): HTMLElement | null => document.getElementById('root-iframe-wrapper');

/**
 * Width of the grid cell that hosts the preview wrapper. The wrapper is always
 * the last grid item, so the last resolved column track is its cell; when the
 * container has no explicit columns (narrow layouts) the cell spans the
 * container. Track sizes are independent of the wrapper's animated max-width,
 * so this stays correct while the max-width transition is running.
 */
const getAvailableWidth = (wrapper: HTMLElement): number => {
  const container = wrapper.parentElement;

  if (!container) {
    return 0;
  }

  const tracks = getComputedStyle(container).gridTemplateColumns.trim().split(/\s+/);
  const cell = parseFloat(tracks[tracks.length - 1]!);

  return Number.isFinite(cell) ? cell : container.clientWidth;
};

/**
 * Space the drag handle needs on each side of the centered wrapper. The
 * computed (not used) width resolves the handle's rem size even while it is
 * hidden in Full Width view.
 */
const getResizerGutter = (wrapper: HTMLElement): number => {
  const resizer = wrapper.querySelector<HTMLElement>('#root-iframe-resizer');
  const width = resizer ? parseFloat(getComputedStyle(resizer).width) : 0;

  return (Number.isFinite(width) ? width : 0) + RESIZER_OFFSET;
};

/**
 * Largest constrained width whose drag handle still fits. The wrapper is
 * centered (`justify-self: center`), so the handle only has half of the spare
 * cell width on its side.
 */
export const getMaxFrameWidth = (wrapper: HTMLElement): number => getAvailableWidth(wrapper) - 2 * getResizerGutter(wrapper);

/**
 * Applies a constrained preview width, or the Full Width view when no width is
 * given or the width would make the handle overflow. Layout is read before any
 * style write to avoid a forced synchronous reflow between them. Callers that
 * apply many widths in a row (dragging) can pass a pre-measured `maxWidth` so
 * each update stays write-only.
 *
 * @returns The applied width, or `undefined` for the Full Width view.
 */
export const applyFrameWidth = (wrapper: HTMLElement, width?: number, maxWidth?: number): number | undefined => {
  if (width && width <= (maxWidth ?? getMaxFrameWidth(wrapper))) {
    wrapper.style.maxWidth = `min(100%, ${width}px)`;
    wrapper.dataset.frameWidth = String(width);
    wrapper.classList.add(FRAME_CONSTRAINED_CLASS);

    return width;
  }

  wrapper.style.removeProperty('max-width');
  delete wrapper.dataset.frameWidth;
  wrapper.classList.remove(FRAME_CONSTRAINED_CLASS);

  return undefined;
};

/** Mirrors the applied width into sessionStorage; Full Width clears it. */
export const persistFrameWidth = (width?: number): void => {
  if (width) {
    sessionStorage.setItem(MSG_IFRAME_SIZE, String(width));
  } else {
    sessionStorage.removeItem(MSG_IFRAME_SIZE);
  }
};

/** Currently applied constrained width, shared across bundles via the DOM. */
export const getAppliedFrameWidth = (wrapper: HTMLElement): number | undefined => {
  const width = Number(wrapper.dataset.frameWidth);

  return width > 0 ? width : undefined;
};

/**
 * Re-checks the applied width after the available space changed (viewport
 * resize, panel position toggle) and switches to Full Width when it no longer
 * fits.
 */
export const revalidateFrameWidth = (wrapper: HTMLElement): void => {
  const width = getAppliedFrameWidth(wrapper);

  if (width && !applyFrameWidth(wrapper, width)) {
    persistFrameWidth(undefined);
  }
};
