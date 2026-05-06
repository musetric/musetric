import type { MouseEvent } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';

const getClickRatio = (event: MouseEvent) => {
  const targetCanvas = event.currentTarget;
  const rect = targetCanvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  return clickX / targetCanvas.clientWidth;
};

const limitFrameIndex = (frameIndex: number, frameCount: number) =>
  Math.min(frameCount, Math.max(0, frameIndex));

const getWaveformFrameIndex = (event: MouseEvent) => {
  const { frameCount } = engine.store.get();
  if (!frameCount) return undefined;

  const clickRatio = getClickRatio(event);
  return limitFrameIndex(Math.floor(clickRatio * frameCount), frameCount);
};

const getSpectrogramFrameIndex = (event: MouseEvent) => {
  const { frameCount, frameIndex } = engine.store.get();
  if (!frameCount) return undefined;

  const { visibleTime, playheadRatio } = useSettingsStore.getState();
  const clickRatio = getClickRatio(event);
  const { sampleRate } = engine.context;
  const clickOffsetRatio = clickRatio - playheadRatio;
  const frameOffset = visibleTime * sampleRate * clickOffsetRatio;

  return limitFrameIndex(Math.floor(frameIndex + frameOffset), frameCount);
};

export const getVisualizationFrameIndex = (event: MouseEvent) => {
  const { visualizationMode } = useProjectStore.getState();
  if (visualizationMode === 'spectrogram') {
    return getSpectrogramFrameIndex(event);
  }
  return getWaveformFrameIndex(event);
};
