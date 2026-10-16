import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';

export type VisualizationView = {
  visibleTime: number;
  playheadRatio: number;
};

export const getVisualizationView = (): VisualizationView => {
  const { viewWindow, frameIndex } = engine.store.get();
  if (viewWindow) {
    return {
      visibleTime: viewWindow.frameCount / engine.context.sampleRate,
      playheadRatio:
        (frameIndex - viewWindow.startFrame) / viewWindow.frameCount,
    };
  }
  const { visibleTime, playheadRatio } = useSettingsStore.getState();
  return { visibleTime, playheadRatio };
};
