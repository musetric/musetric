import { type WindowFunctionName } from '../windowFunction/config.es.js';

export type FftWindowingConfig = {
  windowSize: number;
  windowCount: number;
  zeroPaddingFactor: number;
  windowName: WindowFunctionName;
};
