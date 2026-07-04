import { type api } from '@musetric/api';
import { useEffect, useLayoutEffect, useState } from 'react';
import { engine } from '../../../engine/engine.js';
import { createSubtitleCursor, type SubtitleCursor } from './subtitleCursor.js';
import { getSubtitlePlaybackTimeFromState } from './subtitlePlayback.js';
import { getSubtitleActiveSegmentIndex } from './subtitleTiming.js';

const getCurrentSubtitleActiveSegmentIndex = (
  subtitle: api.subtitle.Segment[],
) =>
  getSubtitleActiveSegmentIndex(
    subtitle,
    getSubtitlePlaybackTimeFromState(engine.store.get()),
  );

export const useSubtitleCursor = (
  subtitle: api.subtitle.Segment[],
): SubtitleCursor => {
  const [subtitleCursor] = useState(() =>
    createSubtitleCursor(getCurrentSubtitleActiveSegmentIndex(subtitle)),
  );

  useLayoutEffect(() => {
    subtitleCursor.setActiveSegmentIndex(
      getCurrentSubtitleActiveSegmentIndex(subtitle),
    );
  }, [subtitle, subtitleCursor]);

  useEffect(
    () =>
      engine.store.subscribe(
        (state) =>
          getSubtitleActiveSegmentIndex(
            subtitle,
            getSubtitlePlaybackTimeFromState(state),
          ),
        (activeSegmentIndex) => {
          subtitleCursor.setActiveSegmentIndex(activeSegmentIndex);
        },
      ),
    [subtitle, subtitleCursor],
  );

  return subtitleCursor;
};
