import { type SubtitleSegmentStatus } from './subtitleTiming.js';

type UnsubscribeSubtitleCursor = () => void;

export type SubtitleCursor = {
  getActiveSegmentIndex: () => number;
  getSegmentStatus: (segmentIndex: number) => SubtitleSegmentStatus;
  setActiveSegmentIndex: (activeSegmentIndex: number) => void;
  subscribeActiveSegmentIndex: (
    callback: () => void,
  ) => UnsubscribeSubtitleCursor;
  subscribeSegmentStatus: (
    segmentIndex: number,
    callback: () => void,
  ) => UnsubscribeSubtitleCursor;
};

export const createSubtitleCursor = (
  initialActiveSegmentIndex: number,
): SubtitleCursor => {
  let activeSegmentIndex = initialActiveSegmentIndex;
  const activeSegmentIndexCallbacks = new Set<() => void>();
  const segmentStatusCallbacks = new Map<number, Set<() => void>>();

  const notifySegmentStatusCallbacks = (
    startIndex: number,
    endIndex: number,
  ) => {
    for (
      let segmentIndex = startIndex;
      segmentIndex <= endIndex;
      segmentIndex += 1
    ) {
      const callbacks = segmentStatusCallbacks.get(segmentIndex);
      callbacks?.forEach((callback) => {
        callback();
      });
    }
  };

  return {
    getActiveSegmentIndex: () => activeSegmentIndex,
    getSegmentStatus: (segmentIndex) => {
      if (segmentIndex === activeSegmentIndex) return 'active';
      if (segmentIndex < activeSegmentIndex) return 'past';
      return 'future';
    },
    setActiveSegmentIndex: (nextActiveSegmentIndex) => {
      if (nextActiveSegmentIndex === activeSegmentIndex) return;

      const startIndex = Math.min(activeSegmentIndex, nextActiveSegmentIndex);
      const endIndex = Math.max(activeSegmentIndex, nextActiveSegmentIndex);
      activeSegmentIndex = nextActiveSegmentIndex;
      activeSegmentIndexCallbacks.forEach((callback) => {
        callback();
      });
      notifySegmentStatusCallbacks(startIndex, endIndex);
    },
    subscribeActiveSegmentIndex: (callback) => {
      activeSegmentIndexCallbacks.add(callback);
      return () => {
        activeSegmentIndexCallbacks.delete(callback);
      };
    },
    subscribeSegmentStatus: (segmentIndex, callback) => {
      const callbacks =
        segmentStatusCallbacks.get(segmentIndex) ?? new Set<() => void>();
      callbacks.add(callback);
      segmentStatusCallbacks.set(segmentIndex, callbacks);

      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          segmentStatusCallbacks.delete(segmentIndex);
        }
      };
    },
  };
};
