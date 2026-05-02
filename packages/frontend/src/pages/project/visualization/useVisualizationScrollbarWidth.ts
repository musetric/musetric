import { subscribeResizeObserver } from '@musetric/resource-utils/dom';
import { type RefObject, useEffect } from 'react';

export const visualizationScrollbarWidthProperty =
  '--visualization-scrollbar-width';

export const useVisualizationScrollbarWidth = (
  listRef: RefObject<HTMLElement | null>,
  variableRef: RefObject<HTMLElement | null>,
  refreshKey?: unknown,
) => {
  useEffect(() => {
    const listElement = listRef.current;
    const variableElement = variableRef.current;
    if (!listElement || !variableElement) {
      return undefined;
    }

    const updateScrollbarWidth = () => {
      const scrollbarWidth = listElement.offsetWidth - listElement.clientWidth;
      variableElement.style.setProperty(
        visualizationScrollbarWidthProperty,
        `${scrollbarWidth}px`,
      );
    };

    updateScrollbarWidth();
    const unsubscribeResizeObserver = subscribeResizeObserver(
      listElement,
      updateScrollbarWidth,
    );

    return () => {
      unsubscribeResizeObserver();
      variableElement.style.removeProperty(visualizationScrollbarWidthProperty);
    };
  }, [listRef, variableRef, refreshKey]);
};
