export const cqtOutputs = ['magnitude', 'logMagnitude'] as const;
const isPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export type CqtOutput = (typeof cqtOutputs)[number];

export type CqtConfig = {
  sampleRate: number;
  hopLength: number;
  fmin: number;
  nBins: number;
  binsPerOctave: number;
  output: CqtOutput;
};

export const validateCqtConfig = (config: CqtConfig): void => {
  const {
    sampleRate: rawSampleRate,
    hopLength,
    fmin: rawFmin,
    nBins,
    binsPerOctave,
    output,
  } = config;
  if (!Number.isFinite(rawSampleRate) || rawSampleRate <= 0) {
    throw new RangeError('CQT sampleRate must be a positive finite number');
  }
  if (!isPositiveInteger(hopLength)) {
    throw new RangeError('CQT hopLength must be a positive safe integer');
  }
  if (!Number.isFinite(rawFmin) || rawFmin <= 0) {
    throw new RangeError('CQT fmin must be a positive finite number');
  }
  if (!isPositiveInteger(nBins)) {
    throw new RangeError('CQT nBins must be a positive safe integer');
  }
  if (!isPositiveInteger(binsPerOctave)) {
    throw new RangeError('CQT binsPerOctave must be a positive safe integer');
  }
  if (!cqtOutputs.includes(output)) {
    throw new RangeError(`Unsupported CQT output: ${String(output)}`);
  }
};
