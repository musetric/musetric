import { type WindowFunctionName } from './config.es.js';

const periodicDenominator = (windowSize: number, periodic?: boolean): number =>
  periodic ? windowSize : windowSize - 1;

export type WindowFunction = (
  windowSize: number,
  periodic?: boolean,
) => Float32Array<ArrayBuffer>;

export const bartlett: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  const last = windowSize - 1;
  for (let i = 0; i < windowSize; i++) {
    filter[i] = (2 / last) * (last / 2 - Math.abs(i - last / 2));
  }
  return filter;
};

export const bartlettHann: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  const last = windowSize - 1;
  for (let i = 0; i < windowSize; i++) {
    filter[i] = (2 / last) * (last / 2 - Math.abs(i - last / 2));
  }
  return filter;
};

export const blackman: WindowFunction = (windowSize, periodic) => {
  const filter = new Float32Array(windowSize);
  const denom = periodicDenominator(windowSize, periodic);
  const alpha = 0.16;
  for (let i = 0; i < windowSize; i++) {
    const n = (2 * Math.PI * i) / denom;
    const k = (4 * Math.PI * i) / denom;
    filter[i] = (1 - alpha) / 2 - 0.5 * Math.cos(n) + (alpha / 2) * Math.cos(k);
  }
  return filter;
};

export const cosine: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    filter[i] = Math.cos((Math.PI * i) / (windowSize - 1) - Math.PI / 2);
  }
  return filter;
};

export const gauss: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  const alpha = 0.25;
  for (let i = 0; i < windowSize; i++) {
    const r1 = (i - (windowSize - 1) / 2) / ((alpha * (windowSize - 1)) / 2);
    filter[i] = Math.E ** (-0.5 * r1 ** 2);
  }
  return filter;
};

export const hamming: WindowFunction = (windowSize, periodic) => {
  const filter = new Float32Array(windowSize);
  const denom = periodicDenominator(windowSize, periodic);
  for (let i = 0; i < windowSize; i++) {
    filter[i] = 0.54 - 0.46 * Math.cos((Math.PI * 2 * i) / denom);
  }
  return filter;
};

export const hann: WindowFunction = (windowSize, periodic) => {
  const filter = new Float32Array(windowSize);
  const denom = periodicDenominator(windowSize, periodic);
  for (let i = 0; i < windowSize; i++) {
    filter[i] = 0.5 * (1 - Math.cos((Math.PI * 2 * i) / denom));
  }
  return filter;
};

export const lanczoz: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  const last = windowSize - 1;
  for (let i = 0; i < windowSize; i++) {
    filter[i] =
      Math.sin(Math.PI * ((2 * i) / last - 1)) /
      (Math.PI * ((2 * i) / last - 1));
  }
  return filter;
};

export const rectangular: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    filter[i] = 1;
  }
  return filter;
};

export const triangular: WindowFunction = (windowSize) => {
  const filter = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    filter[i] =
      (2 / windowSize) * (windowSize / 2 - Math.abs(i - (windowSize - 1) / 2));
  }
  return filter;
};

export const windowFunctions: Record<WindowFunctionName, WindowFunction> = {
  bartlett,
  bartlettHann,
  blackman,
  cosine,
  gauss,
  hamming,
  hann,
  lanczoz,
  rectangular,
  triangular,
};
