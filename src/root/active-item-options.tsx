import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import rootSprite from '../assets/root.svg?url';

import { useRootContext } from './root-context.ts';
import { useOnClickOutside } from './use-click-outside.ts';
import StateAnimationHtml from './state-animation-html.tsx';

export default function ActiveItemOptions() {
  const { activeItem, isTopPanel, isRtl } = useRootContext();
  const key = 'pl-show-state-selector';
  const keyExist = localStorage.getItem(key);
  const optionItemsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [show, setShow] = useState(false);

  const closeMenu = useCallback(() => setShow(false), []);
  const outsideRefs = useMemo(() => [buttonRef], []);

  useOnClickOutside(optionItemsRef, closeMenu, outsideRefs);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && show) {
        setShow(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show]);

  const handleStateToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (keyExist) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, 'true');
    }

    location.reload();

    return false;
  };

  const handleThemeToggle = () => {
    window.dispatchEvent(new CustomEvent('toggleTheme'));
  };

  const toggleCtaText = keyExist ? 'Hide state selector' : 'Show state selector';

  const handleClick = () => {
    setShow(!show);
  };

  const handleRtlToggle = () => {
    const key = 'MSG_IS_RTL';
    const value = isRtl ? 'false' : 'true';

    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    setShow(false);
  };

  const handleChangePanelPosition = () => {
    const key = 'MSG_IS_TOP_PANEL';
    const value = isTopPanel ? 'false' : 'true';

    window.localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));

    setShow(false);
  };

  return activeItem ? (
    <div>
      <button
        ref={buttonRef}
        aria-controls="alveo-settings"
        aria-expanded={show}
        aria-label={show ? 'Close' : 'Settings'}
        className={`alveo-o-root__control-button alveo-o-root__button-${show ? 'close' : 'setting'}`}
        onClick={handleClick}
      >
        <svg className="alveo-o-root__control-svg" viewBox="0 0 30 30">
          <use href={`${rootSprite}#${show ? 'close' : 'setting'}`} />
        </svg>
      </button>

      <div ref={optionItemsRef} className={`alveo-o-root__active-item-options ${show ? 'show' : ''}`} id="alveo-settings">
        <button className="alveo-o-root__nav-item pl-state-toggle" onClick={handleStateToggle}>
          <StateAnimationHtml keyExist={!!keyExist} />
          {toggleCtaText}
        </button>

        <button className="alveo-o-root__nav-item pl-state-toggle" onClick={handleThemeToggle}>
          Change theme
        </button>

        <button className="alveo-o-root__nav-item" onClick={handleRtlToggle}>
          {isRtl ? 'Disable RTL' : 'Enable RTL'}
        </button>

        <button className="alveo-o-root__nav-item panel-position" onClick={handleChangePanelPosition}>
          {isTopPanel ? 'Set side panel' : 'Set top panel'}
        </button>

        <a className="alveo-o-root__nav-item" href={viteAbsoluteUrl(activeItem.path, true)} rel="noreferrer" target="_blank">
          Open in new tab
        </a>

        <button
          className="alveo-o-root__nav-item"
          {...{
            commandfor: 'icon-list-dialog',
            command: 'show-modal',
          }}
        >
          Icon list
        </button>

        <div className="alveo-o-root__nav-item-seperator" />

        <a className="alveo-o-root__nav-item" href="https://tuyen.blog/optimizely-cms/frontend/get-started/" rel="noreferrer" target="_blank">
          About this library
          <svg className="alveo-o-root__control-svg" viewBox="0 0 30 30">
            <use href={`${rootSprite}#external`} />
          </svg>
        </a>
      </div>
    </div>
  ) : (
    <></>
  );
}
