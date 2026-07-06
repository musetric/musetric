import { Box } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { createSpectrogramGesture } from '../spectrogram/createSpectrogramGesture.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { type SpectrogramGestureControls } from '../spectrogram/spectrogramGestureState.js';
import { type SpectrogramGestureContext } from '../spectrogram/spectrogramGestureViewport.js';
import { SpectrogramNoteScale } from '../spectrogram/SpectrogramNoteScale/index.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { current: element } = spectrogramAreaRef;
    if (!element) {
      return;
    }

    let requestedFrameIndex = Math.round(engine.store.get().frameIndex);
    let pointerFrozen = false;
    const { sampleRate } = engine.context;

    const setVisibleTime = (visibleTime: number) => {
      const settings = useSettingsStore.getState();
      if (settings.visibleTime !== visibleTime) {
        settings.setVisibleTime(visibleTime);
      }
    };

    const setFrequencyRange = (minFrequency: number, maxFrequency: number) => {
      useSettingsStore.getState().setFrequencyRange(minFrequency, maxFrequency);
    };

    const seek = (frameIndex: number) => {
      const roundedFrameIndex = Math.round(frameIndex);
      if (roundedFrameIndex === requestedFrameIndex) {
        return;
      }
      requestedFrameIndex = roundedFrameIndex;
      engine.player.seek(roundedFrameIndex, 'spectrogramVisualization');
    };

    const setFreeze = (freeze: boolean) => {
      if (freeze) {
        if (pointerFrozen) return;
        pointerFrozen = true;
        requestedFrameIndex = Math.round(engine.store.get().frameIndex);
        engine.player.setFrozen(true);
        return;
      }
      if (!pointerFrozen) return;
      pointerFrozen = false;
      engine.player.setFrozen(false);
    };

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
      setVisibleTime,
      setFrequencyRange,
      seek,
      setFreeze,
    };

    const gesture = createSpectrogramGesture({
      element,
      context,
      controls,
    });

    const unsubscribeSeek = engine.store.subscribe(
      (state) => state.seekEvent.revision,
      () => {
        const { seekEvent } = engine.store.get();
        if (seekEvent.origin === 'spectrogramVisualization') {
          return;
        }
        gesture.abort();
        requestedFrameIndex = Math.round(seekEvent.frameIndex);
      },
    );

    return () => {
      unsubscribeSeek();
      gesture.dispose();
      setFreeze(false);
    };
  }, []);

  return (
    <Box
      ref={ref}
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
      gridTemplateRows='minmax(0, 1fr) auto'
      position='relative'
      minHeight={0}
      minWidth={0}
    >
      <Box ref={spectrogramAreaRef} height='100%' position='relative'>
        <SpectrogramCanvas />
        <SpectrogramNoteScale />
        <VisualizationCursor />
      </Box>
      <VisualizationTimeline />
    </Box>
  );
};
