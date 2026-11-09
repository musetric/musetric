const getElementCenterY = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return rect.top + rect.height / 2;
};

const isPointerBelowCenter = (
  containerElement: HTMLElement,
  pointerClientY: number,
) => {
  const rect = containerElement.getBoundingClientRect();
  return pointerClientY >= rect.top + rect.height / 2;
};

const centeredTolerancePixels = 2;

const shouldFollowFromElement = (
  containerElement: HTMLElement,
  targetElement: HTMLElement,
) => {
  const rect = containerElement.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;
  const targetCenterY = getElementCenterY(targetElement);
  return (
    targetCenterY >= centerY - centeredTolerancePixels &&
    targetCenterY <= rect.bottom
  );
};

const shouldCenterSoughtElement = (
  containerElement: HTMLElement,
  targetElement: HTMLElement,
) => {
  const rect = containerElement.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;
  const targetCenterY = getElementCenterY(targetElement);
  const targetCenterVisible =
    targetCenterY >= rect.top && targetCenterY <= rect.bottom;
  return !targetCenterVisible || targetCenterY > centerY;
};

const isFullyVisible = (
  containerElement: HTMLElement,
  targetElement: HTMLElement,
) => {
  const rect = containerElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  return targetRect.top >= rect.top && targetRect.bottom <= rect.bottom;
};

const defaultReleaseHoldMs = 650;

type Unsubscribe = () => void;

export type FollowScrollControllerOptions = {
  element: HTMLElement;
  getActiveIndex: () => number;
  subscribeActiveIndex: (callback: () => void) => Unsubscribe;
  locateElement: (index: number) => HTMLElement | null;
  getRevision: () => number;
  subscribeRevision: (callback: () => void) => Unsubscribe;
  isRevisionIgnored: () => boolean;
  isVisibleElementKept?: () => boolean;
  releaseHoldMs?: number;
};

type PendingSeek = {
  revision: number;
  ignored: boolean;
};

export type FollowScrollController = {
  reset: () => void;
  activate: (index: number, pointerClientY: number) => void;
  centerActive: () => void;
  revealActive: () => void;
  dispose: () => void;
};

export const createFollowScrollController = (
  options: FollowScrollControllerOptions,
): FollowScrollController => {
  const {
    element,
    getActiveIndex,
    subscribeActiveIndex,
    locateElement,
    getRevision,
    subscribeRevision,
    isRevisionIgnored,
    isVisibleElementKept,
    releaseHoldMs = defaultReleaseHoldMs,
  } = options;
  let scrollFrame: number | undefined = undefined;
  let releaseTimeout: number | undefined = undefined;
  let scrollHeld = false;
  let pointerScrollHeld = false;
  let touchScrollHeld = false;
  let skippedFollowIndex: number | undefined = undefined;
  let skippedRevision: number | undefined = undefined;
  let activeIndex = getActiveIndex();
  let revision = getRevision();
  let disposed = false;
  let pendingSeek: PendingSeek | undefined = undefined;

  const clearReleaseTimeout = () => {
    if (releaseTimeout === undefined) return;
    window.clearTimeout(releaseTimeout);
    releaseTimeout = undefined;
  };

  const cancelScheduledCentering = () => {
    if (scrollFrame === undefined) return;
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  };

  const scrollToElement = (
    targetElement: HTMLElement,
    block: ScrollLogicalPosition,
  ) => {
    cancelScheduledCentering();
    scrollFrame = window.requestAnimationFrame(() => {
      targetElement.scrollIntoView({ block, behavior: 'smooth' });
      scrollFrame = undefined;
    });
  };

  const centerElement = (targetElement: HTMLElement) => {
    scrollToElement(targetElement, 'center');
  };

  const centerActiveImmediately = (behavior: ScrollBehavior) => {
    const activeElement = locateElement(getActiveIndex());
    if (activeElement) {
      activeElement.scrollIntoView({ block: 'center', behavior });
    }
  };

  const isKeptInPlace = (targetElement: HTMLElement) =>
    isVisibleElementKept?.() === true && isFullyVisible(element, targetElement);

  const holdScroll = () => {
    clearReleaseTimeout();
    scrollHeld = true;
  };

  const releaseScroll = () => {
    clearReleaseTimeout();
    releaseTimeout = window.setTimeout(() => {
      scrollHeld = false;
      releaseTimeout = undefined;
    }, releaseHoldMs);
  };

  const handlePointerDown = () => {
    pointerScrollHeld = true;
    holdScroll();
  };

  const handlePointerMove = () => {
    if (pointerScrollHeld) {
      holdScroll();
    }
  };

  const handlePointerEnd = () => {
    pointerScrollHeld = false;
    releaseScroll();
  };

  const handleTouchStart = () => {
    touchScrollHeld = true;
    holdScroll();
  };

  const handleTouchMove = () => {
    if (touchScrollHeld) {
      holdScroll();
    }
  };

  const handleTouchEnd = () => {
    touchScrollHeld = false;
    releaseScroll();
  };

  const handleWheel = () => {
    holdScroll();
    releaseScroll();
  };

  const handleScroll = () => {
    if (scrollHeld && !pointerScrollHeld && !touchScrollHeld) {
      releaseScroll();
    }
  };

  const handleRevision = () => {
    const seek = pendingSeek;
    pendingSeek = undefined;
    if (disposed || !seek) return;
    revision = seek.revision;

    if (skippedRevision === revision) {
      skippedRevision = undefined;
      return;
    }

    if (seek.ignored) return;

    const activeElement = locateElement(getActiveIndex());
    if (
      activeElement &&
      shouldCenterSoughtElement(element, activeElement) &&
      !isKeptInPlace(activeElement)
    ) {
      centerElement(activeElement);
    }
  };

  const unsubscribeRevision = subscribeRevision(() => {
    const queued = pendingSeek !== undefined;
    pendingSeek = {
      revision: getRevision(),
      ignored: isRevisionIgnored() || scrollHeld,
    };
    if (!queued) {
      queueMicrotask(handleRevision);
    }
  });

  const unsubscribeActiveIndex = subscribeActiveIndex(() => {
    const nextActiveIndex = getActiveIndex();
    const activeChangeFromSeek = getRevision() !== revision;
    const previousActiveElement = locateElement(activeIndex);
    const shouldFollow = previousActiveElement
      ? shouldFollowFromElement(element, previousActiveElement)
      : false;

    activeIndex = nextActiveIndex;

    if (activeChangeFromSeek && isRevisionIgnored()) return;

    if (skippedFollowIndex !== undefined) {
      const shouldSkipFollow = nextActiveIndex === skippedFollowIndex;
      skippedFollowIndex = undefined;
      if (shouldSkipFollow) return;
    }

    if (activeChangeFromSeek || !shouldFollow || scrollHeld) return;

    const nextActiveElement = locateElement(nextActiveIndex);
    if (nextActiveElement && !isKeptInPlace(nextActiveElement)) {
      centerElement(nextActiveElement);
    }
  });

  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('touchstart', handleTouchStart);
  element.addEventListener('touchmove', handleTouchMove);
  element.addEventListener('wheel', handleWheel);
  element.addEventListener('scroll', handleScroll);
  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);
  window.addEventListener('touchend', handleTouchEnd);
  window.addEventListener('touchcancel', handleTouchEnd);
  window.addEventListener('blur', releaseScroll);

  return {
    reset: () => {
      activeIndex = getActiveIndex();
      centerActiveImmediately('instant');
    },
    activate: (index, pointerClientY) => {
      skippedFollowIndex = index;
      skippedRevision = getRevision();

      if (isPointerBelowCenter(element, pointerClientY)) {
        const targetElement = locateElement(index);
        if (targetElement && !isKeptInPlace(targetElement)) {
          centerElement(targetElement);
        }
      }
    },
    centerActive: () => {
      clearReleaseTimeout();
      scrollHeld = false;
      const activeElement = locateElement(getActiveIndex());
      if (activeElement) {
        centerElement(activeElement);
      }
    },
    revealActive: () => {
      const activeElement = locateElement(getActiveIndex());
      if (activeElement && !isFullyVisible(element, activeElement)) {
        scrollToElement(activeElement, 'nearest');
      }
    },
    dispose: () => {
      disposed = true;
      unsubscribeRevision();
      unsubscribeActiveIndex();
      clearReleaseTimeout();
      cancelScheduledCentering();
      pointerScrollHeld = false;
      scrollHeld = false;
      touchScrollHeld = false;
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('blur', releaseScroll);
    },
  };
};
