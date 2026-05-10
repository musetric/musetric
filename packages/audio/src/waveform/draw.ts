import { type ViewColors } from '../common/colors.es.js';
import { type WaveformSegment } from './generateSegments.js';

export type WaveformDraw = {
  run: (segments: WaveformSegment[], colors: ViewColors) => void;
};

const drawWaveform = (
  context: OffscreenCanvasRenderingContext2D,
  segments: WaveformSegment[],
  width: number,
  height: number,
  color: string,
) => {
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  context.fillStyle = color;
  const lastIndex = segments.length - 1;
  if (!lastIndex) {
    const [segment] = segments;
    const yStart = height * ((1 - segment.max) / 2);
    const yEnd = height * ((1 - segment.min) / 2);
    context.beginPath();
    context.rect(0, yStart, width, yEnd - yStart);
    context.fill();
    return;
  }

  const getX = (index: number) => (width * index) / lastIndex;

  context.beginPath();
  for (let i = 0; i < segments.length; i++) {
    const x = getX(i);
    const y = height * ((1 - segments[i].max) / 2);
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  for (let i = lastIndex; i >= 0; i--) {
    const x = getX(i);
    const y = height * ((1 - segments[i].min) / 2);
    context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
};

export const createWaveformDraw = (canvas: OffscreenCanvas): WaveformDraw => {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Context 2D not available on the canvas');
  }

  const ref: WaveformDraw = {
    run: (segments, colors) => {
      const { width, height } = canvas;

      context.clearRect(0, 0, width, height);

      if (!segments.length) {
        return;
      }

      drawWaveform(context, segments, width, height, colors.foreground);
    },
  };
  return ref;
};
