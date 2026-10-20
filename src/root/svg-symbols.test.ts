import { describe, expect, it } from 'vitest';

import { parseSvgSymbols } from './svg-symbols.ts';

describe('native SVG symbol parsing', () => {
  it('retains XML viewBox casing, symbol content and literal IDs', () => {
    const result = parseSvgSymbols(
      '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="one" viewBox="0 0 24 24"><path d="M0 0"/></symbol><symbol id="two"/><symbol/><symbol id=""/></svg>'
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'one', viewBox: '0 0 24 24' });
    expect(result[0]?.svgContent).toContain('<path');
    expect(result[1]).toEqual({ id: 'two', viewBox: '', svgContent: '' });
  });
  it.each(['<svg><broken></svg>', '<html/>'])('reports invalid SVG rather than a successful empty list: %s', (source) => {
    expect(() => parseSvgSymbols(source)).toThrow('Invalid SVG');
  });
});
