import { transformInPlace } from './fft.es.js';

const createHannWindow = (size: number) =>
  Float64Array.from(
    { length: size },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size),
  );

export type PowerSpectrum = {
  frequencies: Float64Array;
  density: Float64Array;
};

export const getWelchDensity = (
  samples: ArrayLike<number>,
  sampleRate: number,
  segmentSize: number,
): PowerSpectrum => {
  const window = createHannWindow(segmentSize);
  const windowPower = window.reduce((sum, value) => sum + value * value, 0);
  const step = segmentSize / 2;
  const binCount = segmentSize / 2 + 1;
  const density = new Float64Array(binCount);
  const segmentCount = Math.floor((samples.length - step) / step);
  const re = new Float64Array(segmentSize);
  const im = new Float64Array(segmentSize);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const start = segment * step;
    let mean = 0;
    for (let index = 0; index < segmentSize; index += 1) {
      mean += samples[start + index];
    }
    mean /= segmentSize;
    for (let index = 0; index < segmentSize; index += 1) {
      re[index] = (samples[start + index] - mean) * window[index];
      im[index] = 0;
    }
    transformInPlace(re, im, 1);
    for (let bin = 0; bin < binCount; bin += 1) {
      const edge = bin === 0 || bin === binCount - 1;
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      density[bin] += (edge ? power : 2 * power) / (sampleRate * windowPower);
    }
  }
  for (let bin = 0; bin < binCount; bin += 1) {
    density[bin] /= segmentCount;
  }
  return {
    frequencies: Float64Array.from(
      { length: binCount },
      (_, bin) => (bin * sampleRate) / segmentSize,
    ),
    density,
  };
};

const thirdOctaveEdge = 2 ** (1 / 6);

export const getThirdOctaveLevels = (
  spectrum: PowerSpectrum,
  centers: readonly number[],
): number[] =>
  centers.map((center) => {
    let sum = 0;
    spectrum.frequencies.forEach((frequency, bin) => {
      if (
        frequency >= center / thirdOctaveEdge &&
        frequency < center * thirdOctaveEdge
      ) {
        sum += spectrum.density[bin];
      }
    });
    return 10 * Math.log10(sum);
  });
