import { engine } from '../../../engine/engine.js';
import { getVisualizationView } from '../visualization/visualizationView.js';

const getFramesPerPixel = (width: number): number =>
  (getVisualizationView().visibleTime * engine.context.sampleRate) /
  Math.max(1, width);

export const getXAtFrame = (frame: number, width: number): number => {
  const { frameIndex } = engine.store.get();
  const { playheadRatio } = getVisualizationView();
  return (
    playheadRatio * width + (frame - frameIndex) / getFramesPerPixel(width)
  );
};

export const getLoopPointerFrame = (
  area: HTMLElement,
  clientX: number,
): number => {
  const rect = area.getBoundingClientRect();
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const { frameIndex } = engine.store.get();
  const { playheadRatio } = getVisualizationView();
  return (
    frameIndex +
    (x - playheadRatio * rect.width) * getFramesPerPixel(rect.width)
  );
};
