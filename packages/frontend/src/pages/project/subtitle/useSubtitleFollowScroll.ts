import { type api } from '@musetric/api';
import { isPlaying, isRecording } from '@musetric/engine';
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

    const wordDrag = createSubtitleWordDrag(element, subtitle);
    const controller = createSubtitleFollowController({
      element,
      cursor: subtitleCursor,
      subscribeSeek: (callback) =>
        engine.seeks.subscribe((seekEvent) => {
          if (
            seekEvent.origin !== 'playbackEnd' &&
            seekEvent.origin !== 'hold' &&
            !wordDrag.isActive()
          ) {
            callback();
          }
        }),
      isMoving: () => {
        const state = engine.store.get();
        return !wordDrag.isActive() && (isPlaying(state) || isRecording(state));
      },
      seekWord: (wordStart) => {
        const frameIndex = getSubtitleSeekFrameIndex(
          wordStart,
          engine.store.get(),
        );
        if (frameIndex === undefined || moveLoopToWord(subtitle, wordStart)) {
          return;
        }
        engine.player.seek(frameIndex, 'subtitle');
      },
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
    controllerRef.current?.showActive();
  }, []);
};
