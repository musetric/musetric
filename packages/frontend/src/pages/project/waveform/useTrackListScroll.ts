import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store.js';

export const useTrackListScroll = () => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trackListElement = listRef.current;
    if (!trackListElement) {
      return undefined;
    }

    trackListElement.scrollTop = useProjectStore.getState().trackListScrollTop;

    return useProjectStore.subscribe(
      (state) => state.trackListScrollTop,
      (trackListScrollTop) => {
        if (trackListElement.scrollTop !== trackListScrollTop) {
          trackListElement.scrollTop = trackListScrollTop;
        }
      },
    );
  }, []);

  return listRef;
};
