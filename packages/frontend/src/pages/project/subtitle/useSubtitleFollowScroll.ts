import { type api } from '@musetric/api';
import { type RefObject, useRef } from 'react';
import { type SubtitleCursor } from './subtitleCursor.js';
import { useSubtitleAutoScroll } from './useSubtitleAutoScroll.js';
import { useSubtitleScrollHold } from './useSubtitleScrollHold.js';
import { useSubtitleWordSeek } from './useSubtitleWordSeek.js';

export const useSubtitleFollowScroll = (
  subtitle: api.subtitle.Segment[],
  subtitleCursor: SubtitleCursor,
  subtitleListRef: RefObject<HTMLDivElement | null>,
) => {
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const skippedFollowScrollSegmentIndexRef = useRef<number | undefined>(
    undefined,
  );
  const skippedSeekRevisionRef = useRef<number | undefined>(undefined);
  const subtitleScrollHeldRef = useSubtitleScrollHold(subtitleListRef);

  useSubtitleAutoScroll({
    scrollFrameRef,
    skippedFollowScrollSegmentIndexRef,
    skippedSeekRevisionRef,
    subtitle,
    subtitleCursor,
    subtitleListRef,
    subtitleScrollHeldRef,
  });

  return useSubtitleWordSeek({
    scrollFrameRef,
    skippedFollowScrollSegmentIndexRef,
    skippedSeekRevisionRef,
    subtitle,
    subtitleListRef,
  });
};
