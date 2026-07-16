import {
  type HalfBandDownsamplePlan,
  validateHalfBandDownsamplePlan,
} from '../resample/config.es.js';
import { type CqtConfig, validateCqtConfig } from './config.es.js';

const isPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export type CqtOctavePlan = {
  index: number;
  sampleRate: number;
  hopLength: number;
  fftSize: number;
  binStart: number;
  binCount: number;
};

export type CqtPlan = {
  formatVersion: number;
  generator: string;
  config: CqtConfig;
  earlyDownsampleCount: number;
  octaves: readonly CqtOctavePlan[];
  rowOffsets: Uint32Array;
  fftBins: Uint32Array;
  coefficients: Float32Array;
  binLengths: Float32Array;
  downsample: HalfBandDownsamplePlan;
  payloadSha256: string;
};

const validateCqtPlanHeader = (plan: CqtPlan): void => {
  if (!isPositiveInteger(plan.formatVersion)) {
    throw new RangeError(
      'CQT plan formatVersion must be a positive safe integer',
    );
  }
  if (plan.generator.length === 0) {
    throw new RangeError('CQT plan generator must not be empty');
  }
  validateCqtConfig(plan.config);
  const rawEarlyDownsampleCount = plan.earlyDownsampleCount;
  if (
    !Number.isSafeInteger(rawEarlyDownsampleCount) ||
    rawEarlyDownsampleCount < 0
  ) {
    throw new RangeError(
      'CQT earlyDownsampleCount must be a non-negative safe integer',
    );
  }
};

const validateCqtOctave = (octave: CqtOctavePlan): void => {
  const {
    index: rawIndex,
    sampleRate: rawSampleRate,
    hopLength,
    fftSize,
    binCount,
  } = octave;
  if (!Number.isSafeInteger(rawIndex) || rawIndex < 0) {
    throw new RangeError(
      'CQT octave index must be a non-negative safe integer',
    );
  }
  if (!Number.isFinite(rawSampleRate) || rawSampleRate <= 0) {
    throw new RangeError('CQT octave sampleRate must be positive');
  }
  if (!isPositiveInteger(hopLength)) {
    throw new RangeError('CQT octave hopLength must be positive');
  }
  if (!isPositiveInteger(fftSize) || fftSize % 2 !== 0) {
    throw new RangeError('CQT octave fftSize must be a positive even integer');
  }
  if (!isPositiveInteger(binCount)) {
    throw new RangeError('CQT octave binCount must be positive');
  }
};

const validateCqtOctaves = (plan: CqtPlan): void => {
  const octaveCount = Math.ceil(plan.config.nBins / plan.config.binsPerOctave);
  if (plan.octaves.length !== octaveCount) {
    throw new RangeError('CQT plan octave count does not match its config');
  }
  let expectedBinStart = plan.config.nBins;
  for (const octave of plan.octaves) {
    validateCqtOctave(octave);
    expectedBinStart -= octave.binCount;
    if (octave.binStart !== expectedBinStart) {
      throw new RangeError('CQT octaves must map high frequencies to low');
    }
  }
  if (expectedBinStart !== 0) {
    throw new RangeError(
      'CQT octave bins do not cover the configured CQT bins',
    );
  }
};

const validateCqtProjectionData = (plan: CqtPlan): void => {
  if (plan.rowOffsets.length !== plan.config.nBins + 1) {
    throw new RangeError('CQT rowOffsets have an invalid length');
  }
  if (plan.rowOffsets[0] !== 0) {
    throw new RangeError('CQT rowOffsets must start at zero');
  }
  for (let index = 1; index < plan.rowOffsets.length; index++) {
    if (plan.rowOffsets[index] < plan.rowOffsets[index - 1]) {
      throw new RangeError('CQT rowOffsets must be monotonic');
    }
  }
  const coefficientCount = plan.rowOffsets[plan.rowOffsets.length - 1];
  if (plan.fftBins.length !== coefficientCount) {
    throw new RangeError('CQT fftBins length does not match rowOffsets');
  }
  if (plan.coefficients.length !== coefficientCount * 2) {
    throw new RangeError(
      'CQT coefficients must use interleaved complex values',
    );
  }
  if (plan.binLengths.length !== plan.config.nBins) {
    throw new RangeError('CQT binLengths have an invalid length');
  }
};

const validateCqtPlanPayloadSha256 = (plan: CqtPlan): void => {
  if (!/^[a-f0-9]{64}$/u.test(plan.payloadSha256)) {
    throw new RangeError('CQT plan payloadSha256 must be a SHA-256 hex digest');
  }
};

export const validateCqtPlan = (plan: CqtPlan): void => {
  validateCqtPlanHeader(plan);
  validateCqtOctaves(plan);
  validateCqtProjectionData(plan);
  validateHalfBandDownsamplePlan(plan.downsample);
  validateCqtPlanPayloadSha256(plan);
};
