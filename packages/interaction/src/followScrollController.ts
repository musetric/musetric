const freeMs = 5000;

type Unsubscribe = () => void;

export type FollowScrollControllerOptions = {
  element: HTMLElement;
  getActiveIndex: () => number;
  subscribeActiveIndex: (callback: () => void) => Unsubscribe;
  subscribeSeek: (callback: () => void) => Unsubscribe;
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
  let free: ReturnType<typeof setTimeout> | undefined = undefined;
  let placed: { index: number; scrolled: boolean } | undefined = undefined;

  const place = (behavior: ScrollBehavior) => {
    const index = getActiveIndex();
    if (behavior === 'instant' && placed?.index === index) {
      if (placed.scrolled) {
        userScroll = false;
      }
      return;
    }
    placed = undefined;
    const line = locateElement(index);
    if (!line) return;
    const view = element.getBoundingClientRect();
    const { top, height } = line.getBoundingClientRect();
    const offset = top + height / 2 - view.top;
    const scrolled = offset < 0 || offset > view.height / 2;
    if (scrolled) {
      userScroll = false;
      line.scrollIntoView({ block: 'center', behavior });
    }
    if (behavior === 'instant') {
      placed = { index, scrolled };
    }
  };

  const resizes = new ResizeObserver(() => {
    placed = undefined;
  });
  resizes.observe(element);
  for (const child of element.children) {
    resizes.observe(child);
  }

  const unsubscribeActiveIndex = subscribeActiveIndex(() => {
    if (isMoving() && free === undefined) {
      place('smooth');
    }
  });
  const unsubscribeSeek = subscribeSeek(() => {
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
      placed = undefined;
      if (!userScroll) return;
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
      resizes.disconnect();
      listening.abort();
      unsubscribeActiveIndex();
      unsubscribeSeek();
    },
  };
};
