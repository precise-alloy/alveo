export interface StateOption {
  name: string;
  value: string;
}
export interface State {
  name: string;
  options?: StateOption[];
  multiple?: boolean;
}
export interface ComponentState {
  name: string;
  selector: string;
  button?: { parentSelector?: string; styleModifier: string; zIndex?: number };
  states: State[];
}

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => entities[character]!);

export function createSelect(state: State, classList: DOMTokenList, newId: () => string): string {
  if (!state.options) return '';
  const name = newId();
  const header = state.multiple ? 'Select many...' : (state.options.find((option) => classList.contains(option.value))?.name ?? '---');
  const type = state.multiple ? 'checkbox' : 'radio';
  const options = state.options
    .map((option) => {
      const id = newId();
      const checked = classList.contains(option.value) ? 'checked' : '';

      return (
        `<input name="${name}" class="pl-state-bar__input" type="${type}" id="${id}" data-name="${escapeHtml(option.name)}" value="${escapeHtml(option.value)}" ${checked}/>` +
        `<label class="pl-state-bar__label" for="${id}"><span>${escapeHtml(option.name)}</span></label>`
      );
    })
    .join('');

  // Text and attributes need HTML escaping, unlike application/json raw text.
  // Browser attribute decoding preserves the exact state names and class tokens.
  return (
    `<div class="pl-state-bar__group"><div>${escapeHtml(state.name)}:</div>` +
    `<div class="pl-state-bar__group-header">${escapeHtml(header)}</div>` +
    `<div class="pl-state-bar__checkbox-group">${options}</div></div>`
  );
}

export function createStateButton(state: ComponentState, iconUrl: string): string {
  const modifier = escapeHtml(state.button?.styleModifier ?? '');
  const title = escapeHtml(state.name ? `Show state modifier for: ${state.name}` : 'Show state modifiers');
  const zIndex = state.button?.zIndex;

  if (zIndex !== undefined && !Number.isFinite(zIndex)) throw new TypeError('State button zIndex must be a finite number.');
  const style = zIndex === undefined ? '' : `style="z-index: ${zIndex};"`;

  return (
    `<div class="pl-state ${modifier}" ${style}><div class="pl-state__controls">` +
    `<button type="button" class="pl-state__button" title="${title}" aria-label="${title}">` +
    `<img src="${escapeHtml(iconUrl)}" loading="lazy" alt=""></button></div></div>`
  );
}
