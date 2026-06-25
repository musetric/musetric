import { type ViewSize } from './viewSize.js';

export const getCanvasSize = (canvas: HTMLCanvasElement): ViewSize => ({
  width: canvas.clientWidth,
  height: canvas.clientHeight,
});

export const setCanvasSize = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  viewSize: ViewSize,
) => {
  if (canvas.width === viewSize.width && canvas.height === viewSize.height) {
    return;
  }
  canvas.width = viewSize.width;
  canvas.height = viewSize.height;
};

export const resizeCanvas = (canvas: HTMLCanvasElement): ViewSize => {
  const viewSize = getCanvasSize(canvas);
  setCanvasSize(canvas, viewSize);
  return viewSize;
};
