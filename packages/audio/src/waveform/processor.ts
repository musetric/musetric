import { type ViewColors } from '../common/colors.es.js';
import { createWaveformDraw } from './draw.js';
import { generateWaveformSegments } from './generateSegments.js';

export type WaveformProcessor = {
  setColors: (colors: ViewColors) => void;
  render: (wavePeaks: Float32Array, trackProgress: number) => void;
};

export const createWaveformProcessor = (
  canvas: OffscreenCanvas,
  presetColors: ViewColors,
): WaveformProcessor => {
  const draw = createWaveformDraw(canvas);
  let colors = presetColors;

  return {
    setColors: (nextColors) => {
      colors = nextColors;
    },
    render: (wavePeaks, trackProgress) => {
      const segmentCount = Math.floor(wavePeaks.length / 2);
      const segments = generateWaveformSegments(wavePeaks, segmentCount);
      draw.run(segments, trackProgress, colors);
    },
  };
};
