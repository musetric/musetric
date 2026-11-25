const freeMs = 5000;

type Unsubscribe = () => void;

export type FollowScrollControllerOptions = {
  element: HTMLElement;
  getActiveIndex: () => number;
  subscribeActiveIndex: (callback: () => void) => Unsubscribe;
  subscribeSeek: (callback: (activeIndex: number) => void) => Unsubscribe;
  locateElement: (index: number) => HTMLElement | null;
  isMoving: () => boolean;
};

export type FollowScrollController = {
  reset: () => void;
  showActive: () => void;
  dispose: () => void;
};

export const createFollowScrollController = (
  options: FollowScrollControllerOptions,
): FollowScrollController => {
  const {
    element,
    getActiveIndex,
    subscribeActiveIndex,
    subscribeSeek,
    locateElement,
    isMoving,
  } = options;
  const listening = new AbortController();
  const { signal } = listening;
  let userScroll = false;
  let seekIndex: number | undefined = undefined;
  let free: ReturnType<typeof setTimeout> | undefined = undefined;

  const place = (behavior: ScrollBehavior) => {
    const line = locateElement(getActiveIndex());
    if (!line) return;
    const view = element.getBoundingClientRect();
    const { top, height } = line.getBoundingClientRect();
    const offset = top + height / 2 - view.top;
    if (offset < 0 || offset > view.height / 2) {
      userScroll = false;
      line.scrollIntoView({ block: 'center', behavior });
    }
  };

  const unsubscribeActiveIndex = subscribeActiveIndex(() => {
    if (getActiveIndex() === seekIndex) {
      seekIndex = undefined;
      place('instant');
    } else if (isMoving() && free === undefined) {
      place('smooth');
    }
  });
  const unsubscribeSeek = subscribeSeek((activeIndex) => {
    seekIndex = activeIndex === getActiveIndex() ? undefined : activeIndex;
    place('instant');
  });
  for (const type of ['pointerdown', 'touchmove', 'wheel', 'keydown']) {
    element.addEventListener(
      type,
      (event) => {
        if (event.type !== 'pointerdown' || event.target === element) {
          userScroll = true;
        }
      },
      { passive: true, signal },
    );
  }
  element.addEventListener(
    'scroll',
    () => {
      if (!userScroll) return;
      seekIndex = undefined;
      clearTimeout(free);
      free = setTimeout(() => {
        free = undefined;
        if (isMoving()) {
          place('smooth');
        }
      }, freeMs);
    },
    { passive: true, signal },
  );

  return {
    reset: () => {
      place('instant');
    },
    showActive: () => {
      clearTimeout(free);
      free = undefined;
      place('smooth');
    },
    dispose: () => {
      clearTimeout(free);
      listening.abort();
      unsubscribeActiveIndex();
      unsubscribeSeek();
    },
  };
};
