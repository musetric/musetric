import { type api } from '@musetric/api';
import { type MouseEvent, type RefObject, useCallback } from 'react';
import { engine } from '../../../engine/engine.js';
import {
  getClickedSubtitleWordElement,
  getSubtitleSegmentElementFromWord,
  getSubtitleSegmentElementIndex,
  getSubtitleWordStart,
  isSubtitleListPointerBelowCenter,
  scheduleSubtitleSegmentCentering,
} from './subtitleScroll.js';
import { getSubtitleSeekFrameIndex } from './subtitleSeek.js';

export type UseSubtitleWordSeekOptions = {
  scrollFrameRef: RefObject<number | undefined>;
  skippedFollowScrollSegmentIndexRef: RefObject<number | undefined>;
  skippedSeekRevisionRef: RefObject<number | undefined>;
  subtitle: api.subtitle.Segment[];
  subtitleListRef: RefObject<HTMLDivElement | null>;
};

export const useSubtitleWordSeek = (options: UseSubtitleWordSeekOptions) => {
  const {
    scrollFrameRef,
    skippedFollowScrollSegmentIndexRef,
    skippedSeekRevisionRef,
    subtitle,
    subtitleListRef,
  } = options;

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const subtitleListElement = subtitleListRef.current;
      if (!subtitleListElement) {
        return;
      }

      const clickedWordElement = getClickedSubtitleWordElement(event.target);
      if (!clickedWordElement) {
        return;
      }

      const clickedWordStart = getSubtitleWordStart(clickedWordElement);
      if (clickedWordStart === undefined) {
        return;
      }

      const clickedSegmentElement =
        getSubtitleSegmentElementFromWord(clickedWordElement);
      if (!clickedSegmentElement) {
        return;
      }

      const clickedSegmentIndex = getSubtitleSegmentElementIndex(
        clickedSegmentElement,
      );
      if (
        clickedSegmentIndex === undefined ||
        clickedSegmentIndex >= subtitle.length
      ) {
        return;
      }

      const frameIndex = getSubtitleSeekFrameIndex(
        clickedWordStart,
        engine.store.get(),
      );
      if (frameIndex === undefined) {
        return;
      }

      engine.player.seek(frameIndex, 'subtitle');
      skippedFollowScrollSegmentIndexRef.current = clickedSegmentIndex;
      skippedSeekRevisionRef.current =
        engine.store.get().seekEvent.revision + 1;

      if (
        !isSubtitleListPointerBelowCenter(subtitleListElement, event.clientY)
      ) {
        return;
      }

      scheduleSubtitleSegmentCentering(
        clickedSegmentElement,
        scrollFrameRef,
        'smooth',
      );
    },
    [
      scrollFrameRef,
      skippedFollowScrollSegmentIndexRef,
      skippedSeekRevisionRef,
      subtitle.length,
      subtitleListRef,
    ],
  );
};
