import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';

export const buildConfig = (
  overrides: Partial<SpectrogramConfig> = {},
): SpectrogramConfig => {
  const viewSize = overrides.viewSize ?? { width: 256, height: 128 };
  const canvas = new OffscreenCanvas(viewSize.width, viewSize.height);
  return {
    ...defaultSpectrogramConfig,
    ...overrides,
    canvas,
    viewSize,
  };
};

export const createTone = (
  length: number,
  frequency: number,
  sampleRate: number,
  amplitude = 1,
): Float32Array =>
  Float32Array.from(
    { length },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
