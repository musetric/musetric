import { Box } from '@mui/material';
import { createNumberLimit } from '@musetric/resource-utils';
import { createMultiPointerGesture } from '@musetric/resource-utils/dom';
import {
  maximumSpectrogramFrequency,
  minimumSpectrogramFrequency,
  minimumSpectrogramFrequencyRatio,
} from '@musetric/spectrogram';
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
const wheelZoomSensitivity = 0.002;
const wheelLinePixels = 16;
const wheelPagePixels = 400;

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { current: element } = ref;
    const { current: spectrogramArea } = spectrogramAreaRef;

    if (!element || !spectrogramArea) {
      return;
    }

    let { frameIndex } = engine.store.get();
    let pointerFrozen = false;
    let gestureActive = false;
    let releaseFrozenOnEnd = true;

    const freeze = () => {
      if (pointerFrozen) return;
      pointerFrozen = true;
      engine.player.setFrozen(true);
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
      frameIndex = engine.store.get().frameIndex;
      freeze();
    };

    const handlePointerEnd = () => {
      if (gestureActive) return;
      releaseFrozen();
    };

    element.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);

    type PinchInitial = {
      axis: 'x' | 'y';
      width: number;
      height: number;
      areaLeft: number;
      areaTop: number;
      initialCenter: number;
      initialSpread: number;
      sampleRate: number;
      visibleTime0: number;
      frameIndex0: number;
      playheadRatio: number;
      logMin0: number;
      logMax0: number;
      anchorTime: number;
      anchorLogFreq: number;
      frameCount: number;
    };
    let pinchInitial: PinchInitial | undefined = undefined;

    const horizontalPanUpdate = (
      delta: number,
      isInertia: boolean,
      stop: () => void,
    ) => {
      const { frameCount } = engine.store.get();
      const { width } = spectrogramArea.getBoundingClientRect();

      if (!frameCount || width <= 0) {
        stop();
        return;
      }

      const { visibleTime } = useSettingsStore.getState();
      const frameLimit = createNumberLimit({
        minimum: 0,
        maximum: frameCount,
      });
      const frameDelta =
        (-delta * visibleTime * engine.context.sampleRate) / width;
      const rawFrameIndex = frameIndex + frameDelta;
      const nextFrameIndex = frameLimit.clamp(rawFrameIndex);
      frameIndex = nextFrameIndex;
      engine.player.seek(
        Math.round(nextFrameIndex),
        'spectrogramVisualization',
      );

      if (isInertia && (rawFrameIndex < 0 || rawFrameIndex > frameCount)) {
        stop();
      }
    };

    const verticalPanUpdate = (
      delta: number,
      isInertia: boolean,
      stop: () => void,
    ) => {
      const { height } = spectrogramArea.getBoundingClientRect();
      if (height <= 0) {
        stop();
        return;
      }

      const { minFrequency, maxFrequency, setFrequencyRange } =
        useSettingsStore.getState();
      const logMin = Math.log(minFrequency);
      const logMax = Math.log(maxFrequency);
      const range = logMax - logMin;
      const rawShift = (delta / height) * range;
      let shift = rawShift;
      const minAllowedShift = logMinFrequency - logMin;
      const maxAllowedShift = logMaxFrequency - logMax;
      let clamped = false;

      if (shift < minAllowedShift) {
        shift = minAllowedShift;
        clamped = true;
      }
      if (shift > maxAllowedShift) {
        shift = maxAllowedShift;
        clamped = true;
      }

      if (shift !== 0) {
        const nextMin = Math.exp(logMin + shift);
        const nextMax = Math.exp(logMax + shift);
        setFrequencyRange(nextMin, nextMax);
      }

      if (isInertia && clamped) {
        stop();
      }
    };

    const seedPinch = (
      axis: 'x' | 'y',
      center: number,
      spread: number,
    ): PinchInitial | undefined => {
      const rect = spectrogramArea.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;

      const { visibleTime, playheadRatio, minFrequency, maxFrequency } =
        useSettingsStore.getState();
      const frameCount = engine.store.get().frameCount ?? 0;
      const { sampleRate } = engine.context;
      const visibleTime0 = visibleTime;
      const frameIndex0 = engine.store.get().frameIndex;
      const logMin0 = Math.log(minFrequency);
      const logMax0 = Math.log(maxFrequency);

      const initial: PinchInitial = {
        axis,
        width: rect.width,
        height: rect.height,
        areaLeft: rect.left,
        areaTop: rect.top,
        initialCenter: center,
        initialSpread: Math.max(spread, 1),
        sampleRate,
        visibleTime0,
        frameIndex0,
        playheadRatio,
        logMin0,
        logMax0,
        anchorTime: 0,
        anchorLogFreq: 0,
        frameCount,
      };

      if (axis === 'x') {
        const localX = center - rect.left;
        const leftEdgeTime =
          frameIndex0 / sampleRate - playheadRatio * visibleTime0;
        initial.anchorTime =
          leftEdgeTime + (localX / rect.width) * visibleTime0;
      } else {
        const localY = center - rect.top;
        const range = logMax0 - logMin0;
        initial.anchorLogFreq = logMax0 - (localY / rect.height) * range;
      }

      return initial;
    };

    const updatePinchHorizontal = (center: number, spread: number) => {
      if (!pinchInitial || pinchInitial.axis !== 'x') return;
      const scale = spread / pinchInitial.initialSpread;
      const visibleLimit = createNumberLimit({
        minimum: minVisibleTime,
        maximum: maxVisibleTime,
      });
      const newVisibleTime = visibleLimit.clamp(
        pinchInitial.visibleTime0 / scale,
      );
      const localX = center - pinchInitial.areaLeft;
      const newLeftEdgeTime =
        pinchInitial.anchorTime -
        (localX / pinchInitial.width) * newVisibleTime;
      const rawFrameIndex =
        (newLeftEdgeTime + pinchInitial.playheadRatio * newVisibleTime) *
        pinchInitial.sampleRate;
      const frameLimit = createNumberLimit({
        minimum: 0,
        maximum: pinchInitial.frameCount,
      });
      const nextFrameIndex = frameLimit.clamp(rawFrameIndex);

      const { setVisibleTime } = useSettingsStore.getState();
      setVisibleTime(newVisibleTime);
      frameIndex = nextFrameIndex;
      engine.player.seek(
        Math.round(nextFrameIndex),
        'spectrogramVisualization',
      );
    };

    const updatePinchVertical = (center: number, spread: number) => {
      if (!pinchInitial || pinchInitial.axis !== 'y') return;
      const scale = spread / pinchInitial.initialSpread;
      const range0 = pinchInitial.logMax0 - pinchInitial.logMin0;
      const rangeLimit = createNumberLimit({
        minimum: logMinRange,
        maximum: logMaxRange,
      });
      const newRange = rangeLimit.clamp(range0 / scale);
      const localY = center - pinchInitial.areaTop;
      let newLogMax =
        pinchInitial.anchorLogFreq + (localY / pinchInitial.height) * newRange;
      let newLogMin = newLogMax - newRange;

      if (newLogMin < logMinFrequency) {
        const shift = logMinFrequency - newLogMin;
        newLogMin += shift;
        newLogMax += shift;
      }
      if (newLogMax > logMaxFrequency) {
        const shift = newLogMax - logMaxFrequency;
        newLogMin -= shift;
        newLogMax -= shift;
      }
      newLogMin = Math.max(logMinFrequency, newLogMin);
      newLogMax = Math.min(logMaxFrequency, newLogMax);

      const { setFrequencyRange } = useSettingsStore.getState();
      setFrequencyRange(Math.exp(newLogMin), Math.exp(newLogMax));
    };

    const zoomHorizontalAt = (scale: number, clientX: number) => {
      const rect = spectrogramArea.getBoundingClientRect();
      if (rect.width <= 0) return;

      const { visibleTime, playheadRatio, setVisibleTime } =
        useSettingsStore.getState();
      const currentFrameIndex = engine.store.get().frameIndex;
      const frameCount = engine.store.get().frameCount ?? 0;
      if (!frameCount) return;
      const { sampleRate } = engine.context;

      const localX = clientX - rect.left;
      const leftEdgeTime =
        currentFrameIndex / sampleRate - playheadRatio * visibleTime;
      const anchorTime = leftEdgeTime + (localX / rect.width) * visibleTime;

      const visibleLimit = createNumberLimit({
        minimum: minVisibleTime,
        maximum: maxVisibleTime,
      });
      const newVisibleTime = visibleLimit.clamp(visibleTime / scale);

      const newLeftEdgeTime =
        anchorTime - (localX / rect.width) * newVisibleTime;
      const rawFrameIndex =
        (newLeftEdgeTime + playheadRatio * newVisibleTime) * sampleRate;
      const frameLimit = createNumberLimit({ minimum: 0, maximum: frameCount });
      const nextFrameIndex = frameLimit.clamp(rawFrameIndex);

      setVisibleTime(newVisibleTime);
      frameIndex = nextFrameIndex;
      engine.player.seek(
        Math.round(nextFrameIndex),
        'spectrogramVisualization',
      );
    };

    const zoomVerticalAt = (scale: number, clientY: number) => {
      const rect = spectrogramArea.getBoundingClientRect();
      if (rect.height <= 0) return;

      const { minFrequency, maxFrequency, setFrequencyRange } =
        useSettingsStore.getState();
      const logMin = Math.log(minFrequency);
      const logMax = Math.log(maxFrequency);
      const range = logMax - logMin;

      const localY = clientY - rect.top;
      const anchorLogFreq = logMax - (localY / rect.height) * range;

      const rangeLimit = createNumberLimit({
        minimum: logMinRange,
        maximum: logMaxRange,
      });
      const newRange = rangeLimit.clamp(range / scale);

      let newLogMax = anchorLogFreq + (localY / rect.height) * newRange;
      let newLogMin = newLogMax - newRange;

      if (newLogMin < logMinFrequency) {
        const shift = logMinFrequency - newLogMin;
        newLogMin += shift;
        newLogMax += shift;
      }
      if (newLogMax > logMaxFrequency) {
        const shift = newLogMax - logMaxFrequency;
        newLogMin -= shift;
        newLogMax -= shift;
      }
      newLogMin = Math.max(logMinFrequency, newLogMin);
      newLogMax = Math.min(logMaxFrequency, newLogMax);

      setFrequencyRange(Math.exp(newLogMin), Math.exp(newLogMax));
    };

    const handleWheel = (event: WheelEvent) => {
      const wantsVertical = event.ctrlKey || event.metaKey;
      const wantsHorizontal = event.shiftKey;
      if (!wantsVertical && !wantsHorizontal) return;

      event.preventDefault();

      let { deltaY } = event;
      if (event.deltaMode === 1) deltaY *= wheelLinePixels;
      else if (event.deltaMode === 2) deltaY *= wheelPagePixels;

      const scale = Math.exp(-deltaY * wheelZoomSensitivity);

      if (wantsHorizontal) {
        zoomHorizontalAt(scale, event.clientX);
      } else {
        zoomVerticalAt(scale, event.clientY);
      }
    };

    spectrogramArea.addEventListener('wheel', handleWheel, { passive: false });

    const gesture = createMultiPointerGesture({
      element,
      onPanStart: () => {
        gestureActive = true;
        releaseFrozenOnEnd = true;
        frameIndex = engine.store.get().frameIndex;
        freeze();
      },
      onPanUpdate: (event) => {
        const isInertia = event.phase === 'inertia';
        if (event.axis === 'x') {
          horizontalPanUpdate(event.delta, isInertia, event.stop);
        } else {
          verticalPanUpdate(event.delta, isInertia, event.stop);
        }
      },
      onPanEnd: () => {
        gestureActive = false;
        if (releaseFrozenOnEnd) releaseFrozen();
        releaseFrozenOnEnd = true;
      },
      onPinchStart: (event) => {
        gestureActive = true;
        releaseFrozenOnEnd = true;
        freeze();
        pinchInitial = seedPinch(event.axis, event.center, event.spread);
      },
      onPinchUpdate: (event) => {
        if (!pinchInitial) return;
        if (event.axis === 'x') {
          updatePinchHorizontal(event.center, event.spread);
        } else {
          updatePinchVertical(event.center, event.spread);
        }
      },
      onPinchEnd: () => {
        pinchInitial = undefined;
        gestureActive = false;
        if (releaseFrozenOnEnd) releaseFrozen();
        releaseFrozenOnEnd = true;
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
        gesture.stop();
      },
    );

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      spectrogramArea.removeEventListener('wheel', handleWheel);
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
