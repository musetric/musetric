import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeForeignSeek } from '../../../engine/foreignSeek.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { useSettingsStore } from '../settings/store.js';
import {
  createSpectrogramGesture,
  type SpectrogramGestureContext,
  type SpectrogramGestureControls,
} from './createSpectrogramGesture.js';

export const useSpectrogramGesture = (
  elementRef: RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const { sampleRate } = engine.context;
    const freeze = createInteractionFreeze();
    let requestedFrameIndex = Math.round(engine.store.get().frameIndex);

    const context: SpectrogramGestureContext = {
      getSampleRate: () => sampleRate,
      getFrameCount: () => engine.store.get().frameCount ?? 0,
      getFrameIndex: () => engine.store.get().frameIndex,
      getVisibleTime: () => useSettingsStore.getState().visibleTime,
      getPlayheadRatio: () => useSettingsStore.getState().playheadRatio,
      getMinFrequency: () => useSettingsStore.getState().minFrequency,
      getMaxFrequency: () => useSettingsStore.getState().maxFrequency,
    };

    const controls: SpectrogramGestureControls = {
      setVisibleTime: (visibleTime) => {
        const settings = useSettingsStore.getState();
        if (settings.visibleTime !== visibleTime) {
          settings.setVisibleTime(visibleTime);
        }
      },
      setFrequencyRange: (minFrequency, maxFrequency) => {
        useSettingsStore
          .getState()
          .setFrequencyRange(minFrequency, maxFrequency);
      },
      seek: (frameIndex) => {
        const roundedFrameIndex = Math.round(frameIndex);
        if (roundedFrameIndex === requestedFrameIndex) return;
        requestedFrameIndex = roundedFrameIndex;
        engine.player.seek(roundedFrameIndex, 'spectrogramVisualization');
      },
      setFreeze: (shouldFreeze) => {
        if (!shouldFreeze) {
          freeze.release();
          return;
        }
        if (freeze.freeze()) {
          requestedFrameIndex = Math.round(engine.store.get().frameIndex);
        }
      },
    };

    const gesture = createSpectrogramGesture({ element, context, controls });

    const unsubscribeSeek = subscribeForeignSeek(
      'spectrogramVisualization',
      (seekEvent) => {
        gesture.abort();
        requestedFrameIndex = Math.round(seekEvent.frameIndex);
      },
    );

    return () => {
      unsubscribeSeek();
      gesture.dispose();
      freeze.release();
    };
  }, [elementRef]);
};
