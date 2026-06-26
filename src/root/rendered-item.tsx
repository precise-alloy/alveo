import { MouseEvent } from 'react';

import { useRootContext } from './root-context.ts';

export default function RenderedItem(item: SinglePageNode) {
  const { activeItem, setActiveItem } = useRootContext();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.location.hash = item.path;
    setActiveItem(item);

    return false;
  };

  const activeClass = activeItem && activeItem.path === item.path ? ' alveo-o-root__nav-item--active' : '';

  return (
    <a className={'alveo-o-root__nav-item' + activeClass} href={viteAbsoluteUrl(item.path, true)} target="inner" onClick={handleClick}>
      {item.name}
    </a>
  );
}
