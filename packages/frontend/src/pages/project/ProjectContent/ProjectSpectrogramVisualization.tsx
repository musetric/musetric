import { Box } from '@mui/material';
import {
  maximumSpectrogramFrequency,
  minimumSpectrogramFrequency,
  minimumSpectrogramFrequencyRatio,
} from '@musetric/spectrogram';
import { type ViewportState } from '@musetric/utils';
import {
  createViewportGesture,
  type ViewportGestureStateRequest,
  type ViewportGestureUpdate,
} from '@musetric/utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { SpectrogramNoteScale } from '../spectrogram/SpectrogramNoteScale/index.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';

const minVisibleTime = 0.1;
const maxVisibleTime = 60;
const logMinFrequency = Math.log(minimumSpectrogramFrequency);
const logMaxFrequency = Math.log(maximumSpectrogramFrequency);
const logMinRange = Math.log(minimumSpectrogramFrequencyRatio);
const logMaxRange = logMaxFrequency - logMinFrequency;

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { current: element } = ref;
    const { current: spectrogramArea } = spectrogramAreaRef;

    if (!element || !spectrogramArea) {
      return;
    }

    let requestedFrameIndex = Math.round(engine.store.get().frameIndex);
    let pointerFrozen = false;
    let gestureActive = false;
    let releaseFrozenOnEnd = true;
    const { sampleRate } = engine.context;

    const freeze = () => {
      if (pointerFrozen) return;
      pointerFrozen = true;
      engine.player.setFrozen(true);
    };

    const seekSpectrogramFrame = (nextFrameIndex: number) => {
      const roundedFrameIndex = Math.round(nextFrameIndex);

      if (roundedFrameIndex === requestedFrameIndex) {
        return;
      }

      requestedFrameIndex = roundedFrameIndex;
      engine.player.seek(roundedFrameIndex, 'spectrogramVisualization');
    };

    const releaseFrozen = () => {
      if (!pointerFrozen) return;
      pointerFrozen = false;
      engine.player.setFrozen(false);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!event.isPrimary) return;

      releaseFrozenOnEnd = true;
      requestedFrameIndex = Math.round(engine.store.get().frameIndex);
      freeze();
    };

    const handlePointerEnd = () => {
      if (gestureActive) return;
      releaseFrozen();
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointerup', handlePointerEnd);
    element.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);

    const readHorizontalViewportState = (
      request: ViewportGestureStateRequest,
    ): ViewportState | undefined => {
      const { frameCount, frameIndex } = engine.store.get();

      if (!frameCount) {
        return undefined;
      }

      if (request.source === 'wheel') {
        requestedFrameIndex = Math.round(frameIndex);
      }

      const { visibleTime, playheadRatio } = useSettingsStore.getState();

      return {
        kind: 'position',
        position: frameIndex,
        size: visibleTime * sampleRate,
        originRatio: playheadRatio,
        minimumPosition: 0,
        maximumPosition: frameCount,
        minimumSize: minVisibleTime * sampleRate,
        maximumSize: maxVisibleTime * sampleRate,
        panDirection: -1,
      };
    };

    const readVerticalViewportState = (): ViewportState => {
      const { minFrequency, maxFrequency } = useSettingsStore.getState();

      return {
        kind: 'range',
        lower: Math.log(minFrequency),
        upper: Math.log(maxFrequency),
        minimumValue: logMinFrequency,
        maximumValue: logMaxFrequency,
        minimumSize: logMinRange,
        maximumSize: logMaxRange,
        panDirection: 1,
        reverse: true,
      };
    };

    const readViewportState = (
      request: ViewportGestureStateRequest,
    ): ViewportState | undefined => {
      if (request.axis === 'x') {
        return readHorizontalViewportState(request);
      }

      return readVerticalViewportState();
    };

    const applyHorizontalViewportUpdate = (event: ViewportGestureUpdate) => {
      if (event.state.kind !== 'position') {
        return;
      }

      const settings = useSettingsStore.getState();
      const visibleTime = event.state.size / sampleRate;

      if (settings.visibleTime !== visibleTime) {
        settings.setVisibleTime(visibleTime);
      }

      seekSpectrogramFrame(event.state.position);
    };

    const applyVerticalViewportUpdate = (event: ViewportGestureUpdate) => {
      if (event.state.kind !== 'range') {
        return;
      }

      useSettingsStore
        .getState()
        .setFrequencyRange(
          Math.exp(event.state.lower),
          Math.exp(event.state.upper),
        );
    };

    const applyViewportUpdate = (event: ViewportGestureUpdate) => {
      if (event.axis === 'x') {
        applyHorizontalViewportUpdate(event);
        return;
      }

      applyVerticalViewportUpdate(event);
    };

    const handleViewportGestureStart = () => {
      gestureActive = true;
      releaseFrozenOnEnd = true;
      requestedFrameIndex = Math.round(engine.store.get().frameIndex);
      freeze();
    };

    const handleViewportGestureEnd = () => {
      gestureActive = false;
      if (releaseFrozenOnEnd) releaseFrozen();
      releaseFrozenOnEnd = true;
    };

    const gesture = createViewportGesture({
      elements: {
        target: element,
        viewport: spectrogramArea,
      },
      handlers: {
        getState: readViewportState,
        onStart: handleViewportGestureStart,
        onUpdate: applyViewportUpdate,
        onEnd: handleViewportGestureEnd,
      },
    });

    const unsubscribeSeek = engine.store.subscribe(
      (state) => state.seekEvent.revision,
      () => {
        const { seekEvent } = engine.store.get();
        if (seekEvent.origin === 'spectrogramVisualization') {
          return;
        }

        releaseFrozenOnEnd = false;
        pointerFrozen = false;
        requestedFrameIndex = Math.round(seekEvent.frameIndex);
        gesture.stop();
      },
    );

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointerup', handlePointerEnd);
      element.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      unsubscribeSeek();
      gesture.dispose();
      releaseFrozen();
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
