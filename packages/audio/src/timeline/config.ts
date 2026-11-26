export type TimelineConfig = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  pixelRatio: number;
  duration: number;
  frameIndex: number;
  frameCount?: number;
  visibleTime: number;
  playheadRatio: number;
  markerColor: string;
  labelColor: string;
  font: string;
};
