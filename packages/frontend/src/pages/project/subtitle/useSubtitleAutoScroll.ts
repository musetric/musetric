import { type api } from '@musetric/api';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import {
  getSubtitleSegmentElement,
  scheduleSubtitleSegmentCentering,
  scrollSubtitleSegmentToCenter,
  shouldCenterSoughtSubtitleSegment,
  shouldFollowFromSubtitleSegment,
} from './subtitleScroll.js';

export type UseSubtitleAutoScrollOptions = {
  scrollFrameRef: RefObject<number | undefined>;
  skippedFollowScrollSegmentIndexRef: RefObject<number | undefined>;
  skippedSeekRevisionRef: RefObject<number | undefined>;
  subtitle: api.subtitle.Segment[];
  subtitleCursor: SubtitleCursor;
  subtitleListRef: RefObject<HTMLDivElement | null>;
  subtitleScrollHeldRef: RefObject<boolean>;
};

export const useSubtitleAutoScroll = (
  options: UseSubtitleAutoScrollOptions,
) => {
  const {
    scrollFrameRef,
    skippedFollowScrollSegmentIndexRef,
    skippedSeekRevisionRef,
    subtitle,
    subtitleCursor,
    subtitleListRef,
    subtitleScrollHeldRef,
  } = options;
  const activeSegmentIndexRef = useRef(subtitleCursor.getActiveSegmentIndex());
  const seekRevisionRef = useRef(engine.store.get().seekRevision);

  useLayoutEffect(() => {
    const subtitleListElement = subtitleListRef.current;
    if (!subtitleListElement) {
      return;
    }

    const activeSegmentElement = getSubtitleSegmentElement(
      subtitleListElement,
      subtitleCursor.getActiveSegmentIndex(),
    );

    if (activeSegmentElement) {
      scrollSubtitleSegmentToCenter(activeSegmentElement, 'instant');
    }
  }, [subtitle, subtitleCursor, subtitleListRef]);

  useEffect(() => {
    return engine.store.subscribe(
      (state) => state.seekRevision,
      (nextSeekRevision) => {
        seekRevisionRef.current = nextSeekRevision;

        if (skippedSeekRevisionRef.current === nextSeekRevision) {
          skippedSeekRevisionRef.current = undefined;
          return;
        }

        const subtitleListElement = subtitleListRef.current;
        if (!subtitleListElement || subtitleScrollHeldRef.current) {
          return;
        }

        const activeSegmentElement = getSubtitleSegmentElement(
          subtitleListElement,
          subtitleCursor.getActiveSegmentIndex(),
        );

        if (
          activeSegmentElement &&
          shouldCenterSoughtSubtitleSegment(
            subtitleListElement,
            activeSegmentElement,
          )
        ) {
          scheduleSubtitleSegmentCentering(
            activeSegmentElement,
            scrollFrameRef,
            'smooth',
          );
        }
      },
    );
  }, [
    scrollFrameRef,
    skippedSeekRevisionRef,
    subtitleCursor,
    subtitleListRef,
    subtitleScrollHeldRef,
  ]);

  useEffect(() => {
    activeSegmentIndexRef.current = subtitleCursor.getActiveSegmentIndex();

    const unsubscribe = subtitleCursor.subscribeActiveSegmentIndex(() => {
      const nextActiveSegmentIndex = subtitleCursor.getActiveSegmentIndex();
      const activeChangeFromSeek =
        engine.store.get().seekRevision !== seekRevisionRef.current;
      const subtitleListElement = subtitleListRef.current;

      if (!subtitleListElement) {
        activeSegmentIndexRef.current = nextActiveSegmentIndex;
        return;
      }

      const previousActiveSegmentElement = getSubtitleSegmentElement(
        subtitleListElement,
        activeSegmentIndexRef.current,
      );
      const shouldFollow = previousActiveSegmentElement
        ? shouldFollowFromSubtitleSegment(
            subtitleListElement,
            previousActiveSegmentElement,
          )
        : false;

      activeSegmentIndexRef.current = nextActiveSegmentIndex;

      if (skippedFollowScrollSegmentIndexRef.current !== undefined) {
        const shouldSkipFollowScroll =
          nextActiveSegmentIndex === skippedFollowScrollSegmentIndexRef.current;
        skippedFollowScrollSegmentIndexRef.current = undefined;

        if (shouldSkipFollowScroll) {
          return;
        }
      }

      if (
        activeChangeFromSeek ||
        !shouldFollow ||
        subtitleScrollHeldRef.current
      ) {
        return;
      }

      const nextActiveSegmentElement = getSubtitleSegmentElement(
        subtitleListElement,
        nextActiveSegmentIndex,
      );

      if (nextActiveSegmentElement) {
        scheduleSubtitleSegmentCentering(
          nextActiveSegmentElement,
          scrollFrameRef,
          'smooth',
        );
      }
    });

    return () => {
      unsubscribe();

      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
    };
  }, [
    scrollFrameRef,
    skippedFollowScrollSegmentIndexRef,
    subtitleCursor,
    subtitleListRef,
    subtitleScrollHeldRef,
  ]);
};
