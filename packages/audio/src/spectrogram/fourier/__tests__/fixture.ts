import { type ComplexArray } from '../../common/complexArray.js';

export type FourierFixture = {
  name: string;
  windowSize: number;
  input: Float32Array<ArrayBuffer>;
  output: ComplexArray;
};

type ExpectedBin = {
  index: number;
  real?: number;
  imag?: number;
};

const createZeroComplexArray = (windowSize: number): ComplexArray => ({
  real: new Float32Array(windowSize),
  imag: new Float32Array(windowSize),
});

const createExpectedOutput = (
  windowSize: number,
  expectedBins: ExpectedBin[],
): ComplexArray => {
  const output = createZeroComplexArray(windowSize);

  expectedBins.forEach((bin) => {
    const { index, real = 0, imag = 0 } = bin;
    output.real[index] = real;
    output.imag[index] = imag;
  });

  return output;
};

const createSignal = (
  windowSize: number,
  createSample: (sampleIndex: number) => number,
): Float32Array<ArrayBuffer> =>
  Float32Array.from(
    Array.from({ length: windowSize }, (_, sampleIndex) =>
      createSample(sampleIndex),
    ),
  );

const createUnitImpulseFixture = (windowSize: number): FourierFixture => ({
  name: `FFT ${windowSize}-point: unit impulse produces flat spectrum`,
  windowSize,
  input: createSignal(windowSize, (sampleIndex) => (sampleIndex === 0 ? 1 : 0)),
  output: {
    real: Float32Array.from(new Array(windowSize).fill(1)),
    imag: Float32Array.from(new Array(windowSize).fill(0)),
  },
});

const createShiftedImpulseFixture = (windowSize: number): FourierFixture => {
  const shift = Math.floor(windowSize / 3) + 5;

  return {
    name: `FFT ${windowSize}-point: shifted impulse preserves phase ramp`,
    windowSize,
    input: createSignal(windowSize, (sampleIndex) =>
      sampleIndex === shift ? 1 : 0,
    ),
    output: {
      real: createSignal(windowSize, (binIndex) =>
        Math.cos((-2 * Math.PI * binIndex * shift) / windowSize),
      ),
      imag: createSignal(windowSize, (binIndex) =>
        Math.sin((-2 * Math.PI * binIndex * shift) / windowSize),
      ),
    },
  };
};

const createConstantFixture = (windowSize: number): FourierFixture => ({
  name: `FFT ${windowSize}-point: constant goes only to DC`,
  windowSize,
  input: Float32Array.from(new Array(windowSize).fill(1)),
  output: createExpectedOutput(windowSize, [
    {
      index: 0,
      real: windowSize,
    },
  ]),
});

const createNyquistCosineFixture = (windowSize: number): FourierFixture => ({
  name: `FFT ${windowSize}-point: nyquist cosine goes only to N/2`,
  windowSize,
  input: createSignal(windowSize, (sampleIndex) =>
    sampleIndex % 2 === 0 ? 1 : -1,
  ),
  output: createExpectedOutput(windowSize, [
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
    name: `FFT ${windowSize}-point: ${label} sine mirrors imag sign correctly`,
    windowSize,
    input: createSignal(windowSize, (sampleIndex) =>
      Math.sin((2 * Math.PI * binIndex * sampleIndex) / windowSize),
    ),
    output: createExpectedOutput(windowSize, [
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
    name: `FFT ${windowSize}-point: ${label} cosine mirrors real amplitude correctly`,
    windowSize,
    input: createSignal(windowSize, (sampleIndex) =>
      Math.cos((2 * Math.PI * binIndex * sampleIndex) / windowSize),
    ),
    output: createExpectedOutput(windowSize, [
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
    name: `FFT ${windowSize}-point: ${label} phased bin keeps real/imag and mirror signs`,
    windowSize,
    input: createSignal(windowSize, (sampleIndex) => {
      const angle = (2 * Math.PI * binIndex * sampleIndex) / windowSize;

      return (
        cosineAmplitude * Math.cos(angle) + sineAmplitude * Math.sin(angle)
      );
    }),
    output: createExpectedOutput(windowSize, [
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

const createSmallHandWrittenFourierFixtures = (): FourierFixture[] => [
  {
    name: 'FFT 2-point: unit impulse',
    windowSize: 2,
    input: Float32Array.from([1, 0]),
    output: {
      real: Float32Array.from([1, 1]),
      imag: Float32Array.from([0, 0]),
    },
  },
  {
    name: 'FFT 2-point: constant',
    windowSize: 2,
    input: Float32Array.from([1, 1]),
    output: {
      real: Float32Array.from([2, 0]),
      imag: Float32Array.from([0, 0]),
    },
  },
  {
    name: 'FFT 2-point: linear ramp',
    windowSize: 2,
    input: Float32Array.from([0, 1]),
    output: {
      real: Float32Array.from([1, -1]),
      imag: Float32Array.from([0, 0]),
    },
  },
  {
    name: 'FFT 4-point: unit impulse',
    windowSize: 4,
    input: Float32Array.from([1, 0, 0, 0]),
    output: {
      real: Float32Array.from([1, 1, 1, 1]),
      imag: Float32Array.from([0, 0, 0, 0]),
    },
  },
  {
    name: 'FFT 4-point: constant',
    windowSize: 4,
    input: Float32Array.from([1, 1, 1, 1]),
    output: {
      real: Float32Array.from([4, 0, 0, 0]),
      imag: Float32Array.from([0, 0, 0, 0]),
    },
  },
  {
    name: 'FFT 4-point: linear ramp',
    windowSize: 4,
    input: Float32Array.from([0, 1, 2, 3]),
    output: {
      real: Float32Array.from([6, -2, -2, -2]),
      imag: Float32Array.from([0, 2, 0, -2]),
    },
  },
  {
    name: 'FFT 8-point: sin bin 1',
    windowSize: 8,
    input: createSignal(8, (sampleIndex) =>
      Math.sin((2 * Math.PI * sampleIndex) / 8),
    ),
    output: {
      real: Float32Array.from(new Array(8).fill(0)),
      imag: Float32Array.from([0, -4, 0, 0, 0, 0, 0, 4]),
    },
  },
  {
    name: 'FFT 16-point: cos bin 3 and cos bin 5',
    windowSize: 16,
    input: createSignal(
      16,
      (sampleIndex) =>
        Math.cos((2 * Math.PI * 3 * sampleIndex) / 16) +
        Math.cos((2 * Math.PI * 5 * sampleIndex) / 16),
    ),
    output: createExpectedOutput(16, [
      {
        index: 3,
        real: 8,
      },
      {
        index: 13,
        real: 8,
      },
      {
        index: 5,
        real: 8,
      },
      {
        index: 11,
        real: 8,
      },
    ]),
  },
];

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

const diagnosticWindowSizes = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];

export const fourierFixtures: FourierFixture[] = [
  ...createSmallHandWrittenFourierFixtures(),
  ...diagnosticWindowSizes.flatMap((windowSize) =>
    createDiagnosticFourierFixtures(windowSize),
  ),
];
