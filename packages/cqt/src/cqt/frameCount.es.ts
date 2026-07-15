import { type CqtPlan } from './plan.es.js';

export const getDownsampledSampleCount = (rawSampleCount: number): number => {
  if (!Number.isSafeInteger(rawSampleCount) || rawSampleCount < 0) {
    throw new RangeError('CQT sampleCount must be a non-negative safe integer');
  }
  return Math.ceil(rawSampleCount / 2);
};

export const getOctaveSampleCount = (
  rawSampleCount: number,
  rawDownsampleCount: number,
): number => {
  if (!Number.isSafeInteger(rawDownsampleCount) || rawDownsampleCount < 0) {
    throw new RangeError(
      'CQT downsampleCount must be a non-negative safe integer',
    );
  }
  let result = rawSampleCount;
  for (let index = 0; index < rawDownsampleCount; index++) {
    result = getDownsampledSampleCount(result);
  }
  return result;
};

export const getCenteredFrameCount = (
  rawSampleCount: number,
  rawHopLength: number,
): number => {
  if (!Number.isSafeInteger(rawHopLength) || rawHopLength <= 0) {
    throw new RangeError('CQT hopLength must be a positive safe integer');
  }
  if (!Number.isSafeInteger(rawSampleCount) || rawSampleCount < 0) {
    throw new RangeError('CQT sampleCount must be a non-negative safe integer');
  }
  return 1 + Math.floor(rawSampleCount / rawHopLength);
};

export const getCqtFrameCount = (
  rawSampleCount: number,
  plan: Pick<CqtPlan, 'earlyDownsampleCount' | 'octaves'>,
): number => {
  if (!Number.isSafeInteger(rawSampleCount) || rawSampleCount < 0) {
    throw new RangeError('CQT sampleCount must be a non-negative safe integer');
  }
  const minimumSampleCount = 2 ** plan.earlyDownsampleCount;
  if (rawSampleCount < minimumSampleCount) {
    throw new RangeError(
      'CQT input is shorter than the plan early-downsample factor',
    );
  }
  if (plan.octaves.length === 0) {
    throw new RangeError('CQT plan must contain at least one octave');
  }
  const [firstOctave, ...remainingOctaves] = plan.octaves;
  const getOctaveFrameCount = (octave: CqtPlan['octaves'][number]): number => {
    const octaveSamples = getOctaveSampleCount(
      rawSampleCount,
      plan.earlyDownsampleCount + octave.index,
    );
    return getCenteredFrameCount(octaveSamples, octave.hopLength);
  };
  let frameCount = getOctaveFrameCount(firstOctave);
  for (const octave of remainingOctaves) {
    frameCount = Math.min(frameCount, getOctaveFrameCount(octave));
  }
  return frameCount;
};
