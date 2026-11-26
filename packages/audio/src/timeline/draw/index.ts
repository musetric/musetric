import { assertDefined } from '@musetric/utils';
import { type TimelineConfig } from '../config.js';
import { getTimelineMarkers } from './markers.js';

const labelOffset = 4;
const maxLabelMetricsCacheSize = 4096;

const resizeCanvas = (
  config: TimelineConfig,
  width: number,
  height: number,
) => {
  const { canvas, pixelRatio } = config;
  const canvasWidth = Math.max(1, Math.floor(width * pixelRatio));
  const canvasHeight = Math.max(1, Math.floor(height * pixelRatio));

  if (canvas.width === canvasWidth && canvas.height === canvasHeight) {
    return;
  }

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
};

const alignPixel = (value: number, pixelRatio: number) =>
  Math.round(value * pixelRatio) / pixelRatio;

const formatTime = (timeInSeconds: number) => {
  const normalizedTime = Math.max(0, timeInSeconds);
  const minutes = Math.floor(normalizedTime / 60);
  const seconds = Math.floor(normalizedTime - minutes * 60);

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export type TimelineDraw = {
  run: (config: TimelineConfig) => void;
  dispose: () => void;
};

export const createTimelineDraw = (): TimelineDraw => {
  const labelMetricsCache = new Map<
    string,
    Pick<TextMetrics, 'actualBoundingBoxDescent' | 'width'>
  >();

  const getLabelMetrics = (
    context: OffscreenCanvasRenderingContext2D,
    font: string,
    label: string,
  ) => {
    const key = `${font}\n${label}`;
    const cachedMetrics = labelMetricsCache.get(key);

    if (cachedMetrics) {
      return cachedMetrics;
    }

    if (labelMetricsCache.size > maxLabelMetricsCacheSize) {
      labelMetricsCache.clear();
    }

    const metrics = context.measureText(label);
    const labelMetrics = {
      actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
      width: metrics.width,
    };
    labelMetricsCache.set(key, labelMetrics);

    return labelMetrics;
  };

  return {
    run: (config) => {
      const { pixelRatio } = config;
      const width = Math.max(1, config.width);
      const height = Math.max(1, config.height);
      resizeCanvas(config, width, height);
      const context = assertDefined(
        config.canvas.getContext('2d'),
        'Context 2D not available on the timeline canvas',
      );
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
        const labelMetrics = getLabelMetrics(context, config.font, label);

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
      labelMetricsCache.clear();
    },
  };
};
