import { type ComplexArray } from '@musetric/resource-utils/gpu';
import { createWindowSizes } from './windowSizes.es.js';

export type FourierFixture = {
  caseName: string;
  windowSize: number;
  wave: Float32Array<ArrayBuffer>;
  spectrum: ComplexArray;
};

type ExpectedBin = {
  index: number;
  real?: number;
  imag?: number;
};

const positiveSize = (windowSize: number): number => windowSize / 2 + 1;

const createZeroComplexArray = (size: number): ComplexArray => ({
  real: new Float32Array(size),
  imag: new Float32Array(size),
});

const createExpectedOutput = (
  windowSize: number,
  expectedBins: ExpectedBin[],
): ComplexArray => {
  const size = positiveSize(windowSize);
  const output = createZeroComplexArray(size);

  expectedBins.forEach((bin) => {
    const { index, real = 0, imag = 0 } = bin;
    if (index >= size) {
      return;
    }
    output.real[index] = real;
    output.imag[index] = imag;
  });

  return output;
};

const createSignal = (
  size: number,
  createSample: (sampleIndex: number) => number,
): Float32Array<ArrayBuffer> =>
  Float32Array.from(
    Array.from({ length: size }, (_, sampleIndex) => createSample(sampleIndex)),
  );

const createUnitImpulseFixture = (windowSize: number): FourierFixture => ({
  caseName: 'unit impulse produces flat spectrum',
  windowSize,
  wave: createSignal(windowSize, (sampleIndex) => (sampleIndex === 0 ? 1 : 0)),
  spectrum: {
    real: Float32Array.from(new Array(positiveSize(windowSize)).fill(1)),
    imag: new Float32Array(positiveSize(windowSize)),
  },
});

const createShiftedImpulseFixture = (windowSize: number): FourierFixture => {
  const shift = Math.floor(windowSize / 3) + 5;

  return {
    caseName: 'shifted impulse preserves phase ramp',
    windowSize,
    wave: createSignal(windowSize, (sampleIndex) =>
      sampleIndex === shift ? 1 : 0,
    ),
    spectrum: {
      real: createSignal(positiveSize(windowSize), (binIndex) =>
        Math.cos((-2 * Math.PI * binIndex * shift) / windowSize),
      ),
      imag: createSignal(positiveSize(windowSize), (binIndex) =>
        Math.sin((-2 * Math.PI * binIndex * shift) / windowSize),
      ),
    },
  };
};

const createConstantFixture = (windowSize: number): FourierFixture => ({
  caseName: 'constant goes only to DC',
  windowSize,
  wave: Float32Array.from(new Array(windowSize).fill(1)),
  spectrum: createExpectedOutput(windowSize, [
    {
      index: 0,
      real: windowSize,
    },
  ]),
});

const createNyquistCosineFixture = (windowSize: number): FourierFixture => ({
  caseName: 'nyquist cosine goes only to N/2',
  windowSize,
  wave: createSignal(windowSize, (sampleIndex) =>
    sampleIndex % 2 === 0 ? 1 : -1,
  ),
  spectrum: createExpectedOutput(windowSize, [
    {
      index: windowSize / 2,
      real: windowSize,
    },
  ]),
});

const createSineBinFixture = (
  windowSize: number,
  binIndex: number,
  label: string,
): FourierFixture => {
  const mirrorIndex = windowSize - binIndex;

  return {
    caseName: `${label} sine mirrors imag sign correctly`,
    windowSize,
    wave: createSignal(windowSize, (sampleIndex) =>
      Math.sin((2 * Math.PI * binIndex * sampleIndex) / windowSize),
    ),
    spectrum: createExpectedOutput(windowSize, [
      {
        index: binIndex,
        imag: -windowSize / 2,
      },
      {
        index: mirrorIndex,
        imag: windowSize / 2,
      },
    ]),
  };
};

const createCosineBinFixture = (
  windowSize: number,
  binIndex: number,
  label: string,
): FourierFixture => {
  const mirrorIndex = windowSize - binIndex;

  return {
    caseName: `${label} cosine mirrors real amplitude correctly`,
    windowSize,
    wave: createSignal(windowSize, (sampleIndex) =>
      Math.cos((2 * Math.PI * binIndex * sampleIndex) / windowSize),
    ),
    spectrum: createExpectedOutput(windowSize, [
      {
        index: binIndex,
        real: windowSize / 2,
      },
      {
        index: mirrorIndex,
        real: windowSize / 2,
      },
    ]),
  };
};

const createPhasedBinFixture = (
  windowSize: number,
  binIndex: number,
  label: string,
): FourierFixture => {
  const cosineAmplitude = 3;
  const sineAmplitude = 2;
  const mirrorIndex = windowSize - binIndex;

  return {
    caseName: `${label} phased bin keeps real/imag and mirror signs`,
    windowSize,
    wave: createSignal(windowSize, (sampleIndex) => {
      const angle = (2 * Math.PI * binIndex * sampleIndex) / windowSize;

      return (
        cosineAmplitude * Math.cos(angle) + sineAmplitude * Math.sin(angle)
      );
    }),
    spectrum: createExpectedOutput(windowSize, [
      {
        index: binIndex,
        real: (cosineAmplitude * windowSize) / 2,
        imag: (-sineAmplitude * windowSize) / 2,
      },
      {
        index: mirrorIndex,
        real: (cosineAmplitude * windowSize) / 2,
        imag: (sineAmplitude * windowSize) / 2,
      },
    ]),
  };
};

const createDiagnosticFourierFixtures = (
  windowSize: number,
): FourierFixture[] => {
  const nearQuarterBinIndex = windowSize / 4 + 1;
  const nearNyquistBinIndex = windowSize / 2 - 1;

  return [
    createUnitImpulseFixture(windowSize),
    createShiftedImpulseFixture(windowSize),
    createConstantFixture(windowSize),
    createNyquistCosineFixture(windowSize),

    createSineBinFixture(windowSize, 1, 'low-frequency'),
    createCosineBinFixture(windowSize, nearQuarterBinIndex, 'near-quarter'),
    createSineBinFixture(windowSize, nearNyquistBinIndex, 'near-nyquist'),

    createPhasedBinFixture(windowSize, 1, 'low-frequency'),
    createPhasedBinFixture(windowSize, nearQuarterBinIndex, 'near-quarter'),
    createPhasedBinFixture(windowSize, nearNyquistBinIndex, 'near-nyquist'),
  ];
};

const windowSizes = createWindowSizes(32, 1024 * 64);

export const fourierFixtures: FourierFixture[] = windowSizes.flatMap(
  (windowSize) => createDiagnosticFourierFixtures(windowSize),
);
