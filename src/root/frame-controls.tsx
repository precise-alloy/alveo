import { useCallback, useEffect, useRef, useState } from 'react';

import rootSprite from '../assets/root.svg?url';

const MIN_FRAME_SIZE = 350;
const MSG_IFRAME_SIZE = 'MSG_IFRAME_SIZE';

const randomIntFromInterval = (min: number, max: number): number => {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
};

export default function FrameControls() {
  const discoTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [isDisco, setDisco] = useState(false);
  const stopDisco = useCallback(() => {
    clearInterval(discoTimer.current);
    discoTimer.current = undefined;
    setDisco(false);
  }, []);

  useEffect(() => {
    // Freeze automated viewport changes for print and release timers on unmount.
    window.addEventListener('beforeprint', stopDisco);

    return () => {
      window.removeEventListener('beforeprint', stopDisco);
      clearInterval(discoTimer.current);
    };
  }, [stopDisco]);

  const setIFrameWidth = (width?: number) => {
    const wrapper = document.getElementById('root-iframe-wrapper');

    if (!wrapper) {
      return;
    }

    if (width) {
      wrapper.style.maxWidth = `min(100%, ${width}px)`;
      sessionStorage.setItem(MSG_IFRAME_SIZE, width + '');
    } else {
      wrapper.style.removeProperty('max-width');
    }
  };

  const handleMobileClick = () => {
    stopDisco();

    const width = randomIntFromInterval(MIN_FRAME_SIZE, 768);

    setIFrameWidth(width);
  };

  const handleTabletClick = () => {
    stopDisco();

    const width = randomIntFromInterval(768, 1024);

    setIFrameWidth(width);
  };

  const handleDesktopClick = () => {
    stopDisco();

    const maxWidth = document.body.clientWidth - 300;

    const width = randomIntFromInterval(1024, Math.max(1024, maxWidth));

    setIFrameWidth(width);
  };

  const handleFullClick = () => {
    stopDisco();

    setIFrameWidth(undefined);
    sessionStorage.removeItem(MSG_IFRAME_SIZE);
  };

  const handleRandomClick = () => {
    stopDisco();

    const maxWidth = document.body.clientWidth - 300;

    const width = randomIntFromInterval(MIN_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, maxWidth));

    setIFrameWidth(width);
  };

  const handleDiscoClick = () => {
    if (discoTimer.current !== undefined) {
      stopDisco();

      return;
    }

    discoTimer.current = setInterval(() => {
      const maxWidth = document.body.clientWidth - 300;

      const width = randomIntFromInterval(MIN_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, maxWidth));

      setIFrameWidth(width);
    }, 2000);

    setDisco(true);
  };

  return (
    <div className="alveo-o-root__frame-control">
      <div className="alveo-o-root__actual-width" id="root-actual-iframe-width" />
      <div className="alveo-o-root__controls">
        <button aria-label="Mobile View" className="alveo-o-root__control-button" title="Mobile View" onClick={handleMobileClick}>
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#phone`} />
          </svg>
        </button>
        <button aria-label="Tablet View" className="alveo-o-root__control-button" title="Tablet View" onClick={handleTabletClick}>
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#tablet`} />
          </svg>
        </button>
        <button aria-label="Desktop View" className="alveo-o-root__control-button" title="Desktop View" onClick={handleDesktopClick}>
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#desktop`} />
          </svg>
        </button>
        <button aria-label="Full Width View" className="alveo-o-root__control-button" title="Full Width View" onClick={handleFullClick}>
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#hay`} />
          </svg>
        </button>
        <button aria-label="Random Width View" className="alveo-o-root__control-button" title="Random Width View" onClick={handleRandomClick}>
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#random`} />
          </svg>
        </button>
        <button
          aria-label="Disco Mode View"
          aria-pressed={isDisco}
          className="alveo-o-root__control-button"
          title="Disco Mode View"
          onClick={handleDiscoClick}
        >
          <svg className="alveo-o-root__control-svg" viewBox="0 0 24 24">
            <use href={`${rootSprite}#disco-ball`} />
          </svg>
        </button>
      </div>
    </div>
  );
}
