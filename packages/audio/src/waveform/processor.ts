import { type WaveformColors } from '../common/colors.es.js';
import { createWaveformDraw } from './draw.js';
import { generateWaveformSegments } from './generateSegments.js';

export type WaveformProcessor = {
  setColors: (colors: WaveformColors) => void;
  render: (wavePeaks: Float32Array) => void;
};

export const createWaveformProcessor = (
  canvas: OffscreenCanvas,
  presetColors: WaveformColors,
): WaveformProcessor => {
  const draw = createWaveformDraw(canvas);
  let colors = presetColors;

  return {
    setColors: (nextColors) => {
      colors = nextColors;
    },
    render: (wavePeaks) => {
      const segmentCount = Math.floor(wavePeaks.length / 2);
      const segments = generateWaveformSegments(wavePeaks, segmentCount);
      draw.run(segments, colors);
    },
  };
};
