import { useSyncExternalStore } from 'react';
import { type SubtitleCursor } from './subtitleCursor.js';
import { type SubtitleSegmentStatus } from './subtitleTiming.js';

export const useSubtitleSegmentStatus = (
  segmentIndex: number,
  subtitleCursor: SubtitleCursor,
): SubtitleSegmentStatus =>
  useSyncExternalStore(
    (callback) => subtitleCursor.subscribeSegmentStatus(segmentIndex, callback),
    () => subtitleCursor.getSegmentStatus(segmentIndex),
    () => subtitleCursor.getSegmentStatus(segmentIndex),
  );
