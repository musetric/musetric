import { type TimelineConfig } from '../config.js';
import { createCanvasCell } from './canvas.js';
import { getTimelineMarkers } from './markers.js';

const labelOffset = 4;

export type TimelineDraw = {
  run: (config: TimelineConfig) => void;
  dispose: () => void;
};

const resizeCanvas = (canvas: HTMLCanvasElement, pixelRatio: number) => {
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

  if (canvas.width === width && canvas.height === height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
};

const alignPixel = (value: number, pixelRatio: number) =>
  Math.round(value * pixelRatio) / pixelRatio;

const formatTime = (timeInSeconds: number) => {
  const normalizedTime = Math.max(0, timeInSeconds);
  const minutes = Math.floor(normalizedTime / 60);
  const seconds = Math.floor(normalizedTime - minutes * 60);

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const createTimelineDraw = (): TimelineDraw => {
  const canvasCell = createCanvasCell();

  return {
    run: (config) => {
      const { canvas } = config;
      const { context } = canvasCell.get(canvas);
      const pixelRatio = window.devicePixelRatio;
      resizeCanvas(canvas, pixelRatio);

      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      const markers = getTimelineMarkers(config, width);

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      context.fillStyle = config.markerColor;
      for (const marker of markers) {
        const x = marker.ratio * width;

        if (x < 0 || x > width) {
          continue;
        }

        const markerHeight = marker.isMajor ? height : height / 2;
        context.fillRect(
          alignPixel(x, pixelRatio),
          0,
          1 / pixelRatio,
          alignPixel(markerHeight, pixelRatio),
        );
      }

      context.fillStyle = config.labelColor;
      context.font = config.font;
      context.textBaseline = 'alphabetic';

      for (const marker of markers) {
        if (!marker.isMajor) {
          continue;
        }

        const label = formatTime(marker.time);
        const labelX = marker.ratio * width + labelOffset;
        const labelMetrics = context.measureText(label);

        if (labelX + labelMetrics.width < 0 || labelX > width) {
          continue;
        }

        context.fillText(
          label,
          labelX,
          height - labelMetrics.actualBoundingBoxDescent,
        );
      }
    },
    dispose: () => {
      canvasCell.dispose();
    },
  };
};
