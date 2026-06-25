import { type ViewSize } from './viewSize.js';

export const setOffscreenCanvasSize = (
  canvas: OffscreenCanvas,
  viewSize: ViewSize,
) => {
  if (canvas.width === viewSize.width && canvas.height === viewSize.height) {
    return;
  }
  canvas.width = viewSize.width;
  canvas.height = viewSize.height;
};
