import { defaultSampleRate } from '@musetric/resource-utils';

export const runs = 10;
export const skipRuns = 10;
export const progress = 0.5;

export const canvasWidth = 1920;
export const canvasHeight = 1080;

const getWindowSizes = () => {
  const sizes: number[] = [];
  for (let size = 64; size <= 1024 * 16; size *= 2) {
    sizes.push(size);
  }
  return sizes;
};
export const windowSizes = getWindowSizes();

const createSamples = () => {
  const result = new Float32Array(defaultSampleRate * 60 * 3);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.random() * 2 - 1;
  }
  return result;
};
export const samples = createSamples();
export const recordingSamples = createSamples();
