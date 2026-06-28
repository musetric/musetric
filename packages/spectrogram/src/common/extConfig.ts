import { type SpectrogramConfig } from '../config.cross.js';

export type ExtSpectrogramConfig = SpectrogramConfig & {
  windowCount: number;
};

export type SpectrogramSampleRange = {
  frameIndex: number;
  frameCount: number;
};
