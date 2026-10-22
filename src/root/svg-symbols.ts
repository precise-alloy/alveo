export interface ParsedSvgSymbol {
  id: string;
  viewBox: string;
  svgContent: string;
}

export function parseSvgSymbols(content: string): ParsedSvgSymbol[] {
  const document = new DOMParser().parseFromString(content, 'image/svg+xml');

  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error('Invalid SVG sprite document.');
  }

  return Array.from(document.querySelectorAll('symbol[id]'))
    .filter((symbol) => symbol.id !== '')
    .map((symbol) => ({
      id: symbol.id,
      viewBox: symbol.getAttribute('viewBox') ?? '',
      svgContent: symbol.innerHTML,
    }));
}
