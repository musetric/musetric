import { type SpectrogramConfig } from '../config.cross.js';

export type ExtSpectrogramConfig = SpectrogramConfig & {
  windowCount: number;
};
