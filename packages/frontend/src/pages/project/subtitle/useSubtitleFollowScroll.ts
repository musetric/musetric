import { type api } from '@musetric/api';
import { type RefObject, useLayoutEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import { createSubtitleFollowController } from './subtitleFollowController.js';
import { getSubtitleSeekFrameIndex } from './subtitleSeek.js';

export const useSubtitleFollowScroll = (
  subtitle: api.subtitle.Segment[],
  subtitleCursor: SubtitleCursor,
  subtitleListRef: RefObject<HTMLDivElement | null>,
) => {
  useLayoutEffect(() => {
    const element = subtitleListRef.current;
    if (!element) return;

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
        engine.player.seek(frameIndex, 'subtitle');
      },
      isIgnoredSeekOrigin: (origin) =>
        origin === 'spectrogramVisualization' ||
        origin === 'tracksVisualization',
    });
    controller.reset();

    return controller.dispose;
  }, [subtitle, subtitleCursor, subtitleListRef]);
};
