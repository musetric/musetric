import { type api } from '@musetric/api';
import { useEffect, useLayoutEffect, useState } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeEnginePosition } from '../../../engine/enginePosition.js';
import { createSubtitleCursor, type SubtitleCursor } from './subtitleCursor.js';
import { getSubtitlePlaybackTime } from './subtitlePlayback.js';
import { getSubtitleActiveSegmentIndex } from './subtitleTiming.js';

const getCurrentSubtitleActiveSegmentIndex = (
  subtitle: api.subtitle.Segment[],
) =>
  getSubtitleActiveSegmentIndex(
    subtitle,
    getSubtitlePlaybackTime(engine.position.read(), engine.store.get()),
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
      subscribeEnginePosition(
        (frameIndex, state) =>
          getSubtitleActiveSegmentIndex(
            subtitle,
            getSubtitlePlaybackTime(frameIndex, state),
          ),
        (activeSegmentIndex) => {
          subtitleCursor.setActiveSegmentIndex(activeSegmentIndex);
        },
      ),
    [subtitle, subtitleCursor],
  );

  return subtitleCursor;
};
