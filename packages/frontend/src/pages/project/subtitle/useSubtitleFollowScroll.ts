import { type api } from '@musetric/api';
import { type RefObject, useLayoutEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { moveLoopToTime } from '../loop/moveLoopToTime.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import { createSubtitleFollowController } from './subtitleFollowController.js';
import {
  getSubtitleSeekFrameIndex,
  subtitleSeekLeadSeconds,
} from './subtitleSeek.js';
import { createSubtitleWordDrag } from './subtitleWordDrag.js';

export const useSubtitleFollowScroll = (
  subtitle: api.subtitle.Segment[],
  subtitleCursor: SubtitleCursor,
  subtitleListRef: RefObject<HTMLDivElement | null>,
) => {
  useLayoutEffect(() => {
    const element = subtitleListRef.current;
    if (!element) return;

    const wordDrag = createSubtitleWordDrag(element, subtitle);
    const controller = createSubtitleFollowController({
      element,
      cursor: subtitleCursor,
      subtitleLength: subtitle.length,
      getSeekEvent: () => engine.store.get().seekEvent,
      subscribeSeekRevision: (callback) =>
        engine.store.subscribe((state) => state.seekEvent.revision, callback),
      getSeekFrameIndex: (playbackTime) =>
        getSubtitleSeekFrameIndex(playbackTime, engine.store.get()),
      seek: (frameIndex) => {
        const time =
          frameIndex / engine.context.sampleRate + subtitleSeekLeadSeconds;
        if (moveLoopToTime(subtitle, time)) {
          return;
        }
        engine.player.seek(frameIndex, 'subtitle');
      },
      isIgnoredSeekOrigin: (origin) =>
        wordDrag.isActive() ||
        origin === 'playhead' ||
        origin === 'spectrogramVisualization' ||
        origin === 'tracksVisualization',
    });
    controller.reset();

    return () => {
      wordDrag.dispose();
      controller.dispose();
    };
  }, [subtitle, subtitleCursor, subtitleListRef]);
};
