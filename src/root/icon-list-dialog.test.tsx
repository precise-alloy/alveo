import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IconListDialog from './icon-list-dialog.tsx';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('virtual:alveo/svg-sprites', () => ({ sprites: { '/icons.svg': load } }));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const clipboard = { writeText: vi.fn() };
const source = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="one" viewBox="0 0 24 24"><path d="M0 0"/></symbol><symbol id="two"/></svg>';
const open = (dialog: HTMLDialogElement, state = true) => {
  dialog.open = state;
  fireEvent(dialog, new Event('toggle'));
};

beforeEach(() => {
  load.mockReset().mockResolvedValue(source);
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
});
afterEach(() => {
  vi.useRealTimers();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('icon dialog', () => {
  it('defers SVG loading until opening, caches results and filters natively parsed symbols', async () => {
    const view = render(<IconListDialog />);
    const dialog = view.container.querySelector('dialog')!;

    expect(load).not.toHaveBeenCalled();
    open(dialog);
    await waitFor(() => expect(view.container.querySelectorAll('.alveo-o-icon-list-dialog__item')).toHaveLength(2));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search for icon' }), { target: { value: 'TWO' } });
    expect(view.container.querySelectorAll('.alveo-o-icon-list-dialog__item')).toHaveLength(1);
    open(dialog, false);
    open(dialog);
    expect(load).toHaveBeenCalledOnce();
  });

  it('reports invalid XML/fetch failures and retries on reopening', async () => {
    load.mockResolvedValueOnce('<svg><broken></svg>');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<IconListDialog />);
    const dialog = view.container.querySelector('dialog')!;

    open(dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load icons');
    open(dialog, false);
    open(dialog);
    await waitFor(() => expect(view.container.querySelectorAll('.alveo-o-icon-list-dialog__item')).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('copies IDs, clears previous tooltips, and releases pending timers on unmount', async () => {
    const view = render(<IconListDialog />);

    open(view.container.querySelector('dialog')!);
    await waitFor(() => expect(view.container.querySelectorAll('.alveo-o-icon-list-dialog__item')).toHaveLength(2));
    vi.useFakeTimers();
    const buttons = view.container.querySelectorAll<HTMLButtonElement>('.alveo-o-icon-list-dialog__item');

    await act(async () => {
      fireEvent.click(buttons[0]!);
    });
    expect(clipboard.writeText).toHaveBeenCalledWith('#one');
    expect(buttons[0]!.querySelector('span')).toHaveClass('show');
    await act(async () => {
      fireEvent.click(buttons[1]!);
    });
    expect(buttons[0]!.querySelector('span')).not.toHaveClass('show');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(buttons[1]!.querySelector('span')).not.toHaveClass('show');
    await act(async () => {
      fireEvent.click(buttons[0]!);
    });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs clipboard errors instead of claiming a successful copy', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<IconListDialog />);

    open(view.container.querySelector('dialog')!);
    await waitFor(() => expect(view.container.querySelectorAll('.alveo-o-icon-list-dialog__item')).toHaveLength(2));
    fireEvent.click(view.container.querySelector('.alveo-o-icon-list-dialog__item')!);
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(view.container.querySelector('.show')).toBeNull();
  });
});
