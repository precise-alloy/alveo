import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sprites } from 'virtual:alveo/svg-sprites';

import { parseSvgSymbols, type ParsedSvgSymbol } from './svg-symbols.ts';

function SvgIcon({
  id,
  viewBox,
  svgContent,
  copySvgId,
}: ParsedSvgSymbol & {
  copySvgId: (id: string, el: HTMLElement | null) => void;
}) {
  const inner = svgContent.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const tooltipRef = useRef<HTMLElement>(null);

  return (
    <button className="alveo-o-icon-list-dialog__item" onClick={() => copySvgId(id, tooltipRef.current)}>
      <span ref={tooltipRef} className="alveo-o-icon-list-dialog__copy-tooltip">
        Copied!
      </span>
      <svg dangerouslySetInnerHTML={{ __html: inner }} aria-label={id} height={24} viewBox={viewBox} width={24} xmlns="http://www.w3.org/2000/svg" />
      <span className="alveo-o-icon-list-dialog__icon-id">{id}</span>
    </button>
  );
}

const IconListDialog = () => {
  const [allSvgs, setAllSvgs] = useState<ParsedSvgSymbol[]>([]);
  const [searchValue, setSearchValue] = useState<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);
  const mounted = useRef(false);
  const activeTooltip = useRef<HTMLElement | null>(null);

  const parseSvg = async (): Promise<ParsedSvgSymbol[]> => {
    const data: ParsedSvgSymbol[] = [];

    for (const load of Object.values(sprites)) {
      data.push(...parseSvgSymbols(await load()));
    }

    return data;
  };

  const filteredSvgs = useMemo(() => allSvgs.filter((s) => s.id.toLowerCase().includes(searchValue.toLowerCase())), [allSvgs, searchValue]);

  const copySvgId = useCallback(async (id: string, el: HTMLElement | null) => {
    if (!el) return;

    try {
      await navigator.clipboard.writeText(`#${id}`);
      if (!mounted.current) return;
      activeTooltip.current?.classList.remove('show');
      activeTooltip.current = el;
      el.classList.add('show');

      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        el.classList.remove('show');
      }, 2000);
    } catch (error) {
      console.error('[alveo] Cannot copy icon:', error);
    }
  }, []);

  const handleSearchIcon = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;

    setSearchValue(val);
  };

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const loadIcons = async () => {
    if (loaded.current) return;
    loaded.current = true;
    setLoadError('');
    try {
      const data = await parseSvg();

      if (mounted.current) setAllSvgs(data);
    } catch (error) {
      loaded.current = false;
      console.error('[alveo] Cannot load SVG sprites:', error);
      if (mounted.current) setLoadError('Unable to load icons. Close and reopen the dialog to retry.');
    }
  };

  return (
    <dialog
      aria-label="Icon list"
      className="alveo-o-icon-list-dialog"
      id="icon-list-dialog"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadIcons();
      }}
    >
      {loadError && <p role="alert">{loadError}</p>}
      <p>Total: {allSvgs.length} icons</p>

      <div className="alveo-o-icon-list-dialog__search">
        <input aria-label="Search for icon" placeholder="Search for icon" value={searchValue} onChange={handleSearchIcon} />
      </div>

      <div className="alveo-o-icon-list-dialog__svg-list">
        {filteredSvgs.map((svg, i) => (
          <SvgIcon key={i} copySvgId={copySvgId} id={svg.id} svgContent={svg.svgContent} viewBox={svg.viewBox} />
        ))}
      </div>

      <button
        {...{
          command: 'close',
          commandfor: 'icon-list-dialog',
        }}
      >
        Close
      </button>
    </dialog>
  );
};

export default IconListDialog;
