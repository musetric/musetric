import { type TimelineConfig } from '../config.js';
import { createCanvasCell, type TimelineCanvasState } from './canvas.js';
import { getTimelineMarkers, getTimelineWindowStart } from './markers.js';

const labelOffset = 4;
const maxLabelMetricsCacheSize = 4096;
const settleMs = 100;

export const timelineStripScreens = 3;

const resizeCanvas = (
  canvas: HTMLCanvasElement,
  state: Pick<TimelineCanvasState, 'width' | 'height'>,
  pixelRatio: number,
  screens: number,
) => {
  const width = screens * Math.max(1, Math.floor(state.width * pixelRatio));
  const height = Math.max(1, Math.floor(state.height * pixelRatio));

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

type TimelinePainted = {
  key: string;
  start: number;
};

export type TimelineDraw = {
  run: (config: TimelineConfig) => void;
  dispose: () => void;
};

export const createTimelineDraw = (): TimelineDraw => {
  const canvasCell = createCanvasCell();
  const stripCell = createCanvasCell();
  const labelMetricsCache = new Map<
    string,
    Pick<TextMetrics, 'actualBoundingBoxDescent' | 'width'>
  >();
  let settled: TimelinePainted | undefined = undefined;
  let strip: TimelinePainted | undefined = undefined;
  let stripShown = false;
  let settle: ReturnType<typeof setTimeout> | undefined = undefined;

  const getLabelMetrics = (
    context: CanvasRenderingContext2D,
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

  const paint = (
    config: TimelineConfig,
    canvas: HTMLCanvasElement,
    start: number,
    screens: number,
  ) => {
    const { context } = (canvas === config.canvas ? canvasCell : stripCell).get(
      canvas,
    );
    const pixelRatio = window.devicePixelRatio;
    const { width, height } = canvasCell.get(config.canvas);
    resizeCanvas(canvas, { width, height }, pixelRatio, screens);

    const paintedWidth = width * screens;
    const markers = getTimelineMarkers(config, width, start, screens);

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, paintedWidth, height);

    context.fillStyle = config.markerColor;
    for (const marker of markers) {
      const x = marker.ratio * width;

      if (x < 0 || x > paintedWidth) {
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

      if (labelX + labelMetrics.width < 0 || labelX > paintedWidth) {
        continue;
      }

      context.fillText(
        label,
        labelX,
        height - labelMetrics.actualBoundingBoxDescent,
      );
    }
  };

  const getKey = (config: TimelineConfig) => {
    const { width, height } = canvasCell.get(config.canvas);
    return [
      width,
      height,
      window.devicePixelRatio,
      config.duration,
      config.visibleTime,
      config.markerColor,
      config.labelColor,
      config.font,
    ].join('\n');
  };

  const showStrip = (config: TimelineConfig, shown: boolean) => {
    if (stripShown === shown) {
      return;
    }
    stripShown = shown;
    config.canvas.style.visibility = shown ? 'hidden' : '';
    config.stripCanvas.style.visibility = shown ? 'visible' : 'hidden';
  };

  const settleAt = (config: TimelineConfig) => {
    const key = getKey(config);
    const start = getTimelineWindowStart(config);
    paint(config, config.canvas, start, 1);
    settled = { key, start };
    showStrip(config, false);
  };

  return {
    run: (config) => {
      clearTimeout(settle);
      const key = getKey(config);
      const start = getTimelineWindowStart(config);
      if (settled?.key !== key) {
        strip = undefined;
        settleAt(config);
        return;
      }
      if (!stripShown && settled.start === start) {
        return;
      }
      const { width } = canvasCell.get(config.canvas);
      let shift =
        strip?.key === key
          ? ((strip.start - start) / config.visibleTime) * width
          : Number.NaN;
      if (!(shift <= 0 && shift >= -(timelineStripScreens - 1) * width)) {
        const middle = start - config.visibleTime;
        paint(config, config.stripCanvas, middle, timelineStripScreens);
        strip = { key, start: middle };
        shift = -width;
      }
      config.stripCanvas.style.transform = `translateX(${alignPixel(shift, window.devicePixelRatio)}px)`;
      showStrip(config, true);
      settle = setTimeout(() => {
        settleAt(config);
      }, settleMs);
    },
    dispose: () => {
      clearTimeout(settle);
      settled = undefined;
      strip = undefined;
      canvasCell.dispose();
      stripCell.dispose();
      labelMetricsCache.clear();
    },
  };
};
