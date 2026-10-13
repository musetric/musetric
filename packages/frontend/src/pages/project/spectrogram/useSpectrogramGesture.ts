import { getFrequencyRange, toStoredFrequencyRange } from '@musetric/engine';
import {
  type GesturePanStart,
  type ViewportCustomPan,
} from '@musetric/interaction';
import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeForeignSeek } from '../../../engine/foreignSeek.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { setLoopViewWindow } from '../loop/loopView.js';
import { useSettingsStore } from '../settings/store.js';
import {
  createSpectrogramGesture,
  type SpectrogramGestureContext,
  type SpectrogramGestureControls,
} from './createSpectrogramGesture.js';

export type CreateSpectrogramCustomPan = (
  element: HTMLElement,
) => (event: GesturePanStart) => ViewportCustomPan | undefined;

export const useSpectrogramGesture = (
  elementRef: RefObject<HTMLDivElement | null>,
  createCustomPan?: CreateSpectrogramCustomPan,
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
      getViewWindow: () => engine.store.get().viewWindow,
      getRange: () => engine.store.get().range,
      getMinFrequency: () => getFrequencyRange(engine.store.get()).minFrequency,
      getMaxFrequency: () => getFrequencyRange(engine.store.get()).maxFrequency,
      getFrequencyBandCount: () =>
        engine.store.get().spectrogramView === 'spectrum' ? 2 : 1,
    };

    const controls: SpectrogramGestureControls = {
      setVisibleTime: (visibleTime) => {
        const settings = useSettingsStore.getState();
        if (settings.visibleTime !== visibleTime) {
          settings.setVisibleTime(visibleTime);
        }
      },
      setViewWindow: (viewWindow) => {
        setLoopViewWindow(viewWindow);
      },
      setFrequencyRange: (minFrequency, maxFrequency) => {
        engine.store.update((state) => {
          state.frequencyRanges[state.spectrogramView] = toStoredFrequencyRange(
            state,
            { minFrequency, maxFrequency },
          );
        });
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

    const gesture = createSpectrogramGesture({
      element,
      context,
      controls,
      customPan: createCustomPan?.(element),
    });

    const unsubscribeSeek = subscribeForeignSeek(
      'spectrogramVisualization',
      (seekEvent) => {
        requestedFrameIndex = Math.round(seekEvent.frameIndex);
        if (engine.store.get().loopStage !== 'range') {
          gesture.abort();
        }
      },
    );

    return () => {
      unsubscribeSeek();
      gesture.dispose();
      freeze.release();
    };
  }, [elementRef, createCustomPan]);
};
