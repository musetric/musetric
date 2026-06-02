import { type WindowFunctionName } from '../common/config.es.js';

export type FftWindowingConfig = {
  windowSize: number;
  windowCount: number;
  zeroPaddingFactor: number;
  windowName: WindowFunctionName;
};
