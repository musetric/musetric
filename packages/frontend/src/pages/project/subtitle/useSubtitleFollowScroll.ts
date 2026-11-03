import { type api } from '@musetric/api';
import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { moveLoopToWord } from '../loop/moveLoopToWord.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import {
  createSubtitleFollowController,
  type SubtitleFollowController,
} from './subtitleFollowController.js';
import { getSubtitleSeekFrameIndex } from './subtitleSeek.js';
import { createSubtitleWordDrag } from './subtitleWordDrag.js';

export const useSubtitleFollowScroll = (
  subtitle: api.subtitle.Segment[],
  subtitleCursor: SubtitleCursor,
  subtitleListRef: RefObject<HTMLDivElement | null>,
) => {
  const controllerRef = useRef<SubtitleFollowController>(undefined);

  useLayoutEffect(() => {
    const element = subtitleListRef.current;
    if (!element) return;

    const wordDrag = createSubtitleWordDrag(element, subtitle, () => {
      controllerRef.current?.revealActive();
    });
    const controller = createSubtitleFollowController({
      element,
      cursor: subtitleCursor,
      subtitleLength: subtitle.length,
      getSeekEvent: () => engine.store.get().seekEvent,
      subscribeSeekRevision: (callback) =>
        engine.store.subscribe((state) => state.seekEvent.revision, callback),
      getSeekFrameIndex: (playbackTime) =>
        getSubtitleSeekFrameIndex(playbackTime, engine.store.get()),
      seek: (frameIndex, wordStart) => {
        if (moveLoopToWord(subtitle, wordStart)) {
          return;
        }
        engine.player.seek(frameIndex, 'subtitle');
      },
      isIgnoredSeekOrigin: (origin) =>
        wordDrag.isActive() ||
        origin === 'playhead' ||
        origin === 'spectrogramVisualization' ||
        origin === 'tracksVisualization',
      isVisibleLineKept: () => engine.store.get().loopStage !== undefined,
    });
    controller.reset();
    controllerRef.current = controller;

    return () => {
      controllerRef.current = undefined;
      wordDrag.dispose();
      controller.dispose();
    };
  }, [subtitle, subtitleCursor, subtitleListRef]);

  return useCallback(() => {
    controllerRef.current?.centerActive();
  }, []);
};
