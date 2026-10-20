import { describe, expect, it } from 'vitest';

import { createSelect, createStateButton } from './state-markup.ts';

let index = 0;
const newId = () => `id-${index++}`;

describe('safe state markup', () => {
  it('escapes text and attribute delimiters without changing decoded state values', () => {
    const value = 'x"<>&\'';
    const title = '<b>State</b> & "\'';
    const element = document.createElement('div');

    element.classList.add(value);
    element.innerHTML = createSelect({ name: title, options: [{ name: title, value }] }, element.classList, newId);
    expect(element.querySelector('b')).toBeNull();
    expect(element.querySelector('input')?.value).toBe(value);
    expect(element.querySelector('input')?.dataset.name).toBe(title);
    expect(element.querySelector('input')?.checked).toBe(true);
    expect(element.querySelector('label span')?.textContent).toBe(title);
    expect(element.querySelector('.pl-state-bar__group-header')?.textContent).toBe(title);
  });

  it('supports absent options, unselected radio options, and multiple selection', () => {
    const element = document.createElement('div');

    expect(createSelect({ name: 'Empty' }, element.classList, newId)).toBe('');
    element.innerHTML = createSelect({ name: 'Radio', options: [{ name: 'One', value: 'one' }] }, element.classList, newId);
    expect(element.querySelector('.pl-state-bar__group-header')?.textContent).toBe('---');
    expect(element.querySelector('input')?.checked).toBe(false);
    element.innerHTML = createSelect({ name: 'Many', multiple: true, options: [{ name: 'One', value: 'one' }] }, element.classList, newId);
    expect(element.querySelector('input')?.type).toBe('checkbox');
    expect(element.textContent).toContain('Select many...');
  });

  it('escapes button modifiers, titles, and asset URLs, preserving a zero z-index', () => {
    const element = document.createElement('div');

    element.innerHTML = createStateButton(
      {
        name: '"><b>state</b>',
        selector: '.target',
        states: [],
        button: { styleModifier: 'x" data-bad="yes', zIndex: 0 },
      },
      '/subpath/icon.svg?x="&y=1'
    );
    expect(element.querySelector('[data-bad]')).toBeNull();
    expect(element.querySelector('b')).toBeNull();
    expect(element.querySelector('button')?.getAttribute('aria-label')).toContain('"><b>state</b>');
    expect(element.querySelector('img')?.getAttribute('src')).toBe('/subpath/icon.svg?x="&y=1');
    expect(element.querySelector<HTMLElement>('.pl-state')?.style.zIndex).toBe('0');
  });

  it('labels unnamed states and reports invalid z-index values', () => {
    expect(createStateButton({ name: '', selector: '.x', states: [] }, '/icon.svg')).toContain('aria-label="Show state modifiers"');
    expect(() =>
      createStateButton(
        {
          name: 'State',
          selector: '.x',
          states: [],
          button: { styleModifier: '', zIndex: Number.NaN },
        },
        '/icon.svg'
      )
    ).toThrow('finite number');
  });
});
