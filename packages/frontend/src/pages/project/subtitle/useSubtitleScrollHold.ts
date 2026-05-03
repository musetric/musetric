import { type RefObject, useEffect, useRef } from 'react';

export const useSubtitleScrollHold = (
  subtitleListRef: RefObject<HTMLDivElement | null>,
) => {
  const subtitleScrollHeldRef = useRef(false);
  const pointerScrollHeldRef = useRef(false);
  const releaseTimeoutRef = useRef<number | undefined>(undefined);
  const touchScrollHeldRef = useRef(false);

  useEffect(() => {
    const subtitleListElement = subtitleListRef.current;
    if (!subtitleListElement) {
      return;
    }

    const clearReleaseTimeout = () => {
      if (releaseTimeoutRef.current === undefined) {
        return;
      }

      window.clearTimeout(releaseTimeoutRef.current);
      releaseTimeoutRef.current = undefined;
    };

    const holdScroll = () => {
      clearReleaseTimeout();
      subtitleScrollHeldRef.current = true;
    };

    const releaseScroll = () => {
      clearReleaseTimeout();

      releaseTimeoutRef.current = window.setTimeout(() => {
        subtitleScrollHeldRef.current = false;
        releaseTimeoutRef.current = undefined;
      }, 650);
    };

    const holdPointerScroll = () => {
      pointerScrollHeldRef.current = true;
      holdScroll();
    };

    const holdActivePointerScroll = () => {
      if (pointerScrollHeldRef.current) {
        holdScroll();
      }
    };

    const releasePointerScroll = () => {
      pointerScrollHeldRef.current = false;
      releaseScroll();
    };

    const holdTouchScroll = () => {
      touchScrollHeldRef.current = true;
      holdScroll();
    };

    const releaseTouchScroll = () => {
      touchScrollHeldRef.current = false;
      releaseScroll();
    };

    const holdScrollUntilIdle = () => {
      holdScroll();
      releaseScroll();
    };

    const releaseScrollAfterUserScroll = () => {
      if (
        subtitleScrollHeldRef.current &&
        !pointerScrollHeldRef.current &&
        !touchScrollHeldRef.current
      ) {
        releaseScroll();
      }
    };

    subtitleListElement.addEventListener('pointerdown', holdPointerScroll);
    subtitleListElement.addEventListener(
      'pointermove',
      holdActivePointerScroll,
    );
    subtitleListElement.addEventListener('touchstart', holdTouchScroll);
    subtitleListElement.addEventListener('touchmove', holdTouchScroll);
    subtitleListElement.addEventListener('wheel', holdScrollUntilIdle);
    subtitleListElement.addEventListener(
      'scroll',
      releaseScrollAfterUserScroll,
    );
    window.addEventListener('pointerup', releasePointerScroll);
    window.addEventListener('pointercancel', releasePointerScroll);
    window.addEventListener('touchend', releaseTouchScroll);
    window.addEventListener('touchcancel', releaseTouchScroll);
    window.addEventListener('blur', releaseScroll);

    return () => {
      clearReleaseTimeout();
      pointerScrollHeldRef.current = false;
      subtitleScrollHeldRef.current = false;
      touchScrollHeldRef.current = false;

      subtitleListElement.removeEventListener('pointerdown', holdPointerScroll);
      subtitleListElement.removeEventListener(
        'pointermove',
        holdActivePointerScroll,
      );
      subtitleListElement.removeEventListener('touchstart', holdTouchScroll);
      subtitleListElement.removeEventListener('touchmove', holdTouchScroll);
      subtitleListElement.removeEventListener('wheel', holdScrollUntilIdle);
      subtitleListElement.removeEventListener(
        'scroll',
        releaseScrollAfterUserScroll,
      );
      window.removeEventListener('pointerup', releasePointerScroll);
      window.removeEventListener('pointercancel', releasePointerScroll);
      window.removeEventListener('touchend', releaseTouchScroll);
      window.removeEventListener('touchcancel', releaseTouchScroll);
      window.removeEventListener('blur', releaseScroll);
    };
  }, [subtitleListRef]);

  return subtitleScrollHeldRef;
};
