'use client';

import type { RootModel, SinglePageNode } from './models.ts';

import { useEffect, useMemo, useState } from 'react';

import { getCatalogRoutes, getInitialCatalogRoute } from './catalog.ts';
import { RootContext, RootData } from './root-context.ts';
import FrameControls from './frame-controls.tsx';
import ActiveItemOptions from './active-item-options.tsx';
import RootNav from './root-nav.tsx';
import IconListDialog from './icon-list-dialog.tsx';

export default function Root(props: RootModel) {
  const [activeItem, setActiveItem] = useState<SinglePageNode | undefined>(undefined);
  const [isTopPanel, setTopPanel] = useState<boolean>(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('MSG_IS_TOP_PANEL') === 'true' : false
  );
  const [isRtl, setRtl] = useState<boolean>(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('MSG_IS_RTL') === 'true' : false));

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const frame = document.querySelector<HTMLIFrameElement>('#root-iframe');

    if (!frame) {
      return;
    }

    frame.src = viteAbsoluteUrl(activeItem.path, true);
    document.title = activeItem.name + ' - ' + import.meta.env.VITE_TITLE_SUFFIX;
  }, [activeItem]);

  const rootData: RootData = {
    activeItem,
    setActiveItem,
    isTopPanel,
    setTopPanel,
    isRtl,
    setRtl,
  };

  const routes = useMemo(() => getCatalogRoutes(props.routes), [props.routes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveItem(getInitialCatalogRoute(routes, window.location.hash));
  }, [routes]);

  const handleStorageChange = (event: StorageEvent) => {
    switch (event.key) {
      case 'MSG_IS_TOP_PANEL':
        setTopPanel(event.newValue === 'true');
        break;
      case 'MSG_IS_RTL':
        setRtl(event.newValue === 'true');
        break;
    }
  };

  useEffect(() => {
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  useEffect(() => {
    const frame = document.querySelector<HTMLIFrameElement>('#root-iframe');

    if (!frame) {
      return;
    }

    const applyDir = () => {
      frame.contentDocument?.documentElement?.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    };

    applyDir();
    frame.addEventListener('load', applyDir);

    return () => {
      frame.removeEventListener('load', applyDir);
    };
  }, [isRtl]);

  return (
    <RootContext.Provider value={rootData}>
      <div className={`alveo-o-root ${isTopPanel ? 'top-panel' : ''}`}>
        {routes.length === 0 ? (
          <p role="status">No pages or components are available in this project.</p>
        ) : (
          <>
            <RootNav routes={props.routes} />
            <FrameControls />
            <ActiveItemOptions />
            <IconListDialog />
          </>
        )}
      </div>
    </RootContext.Provider>
  );
}
