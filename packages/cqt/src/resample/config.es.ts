export type HalfBandDownsamplePlan = {
  tapCount: number;
  halfCoefficients: Float32Array;
  gain: number;
  delay: number;
  boundary: 'constant';
};

export const validateHalfBandDownsamplePlan = (
  plan: HalfBandDownsamplePlan,
): void => {
  const { tapCount, halfCoefficients, gain: rawGain, delay: rawDelay } = plan;
  if (!Number.isSafeInteger(tapCount) || tapCount < 3) {
    throw new RangeError(
      'Downsample tapCount must be an integer of at least 3',
    );
  }
  if (tapCount % 2 === 0) {
    throw new RangeError('Downsample tapCount must be odd');
  }
  if (halfCoefficients.length !== (tapCount + 1) / 2) {
    throw new RangeError('Downsample halfCoefficients have an invalid length');
  }
  if (!Number.isFinite(rawGain) || rawGain <= 0) {
    throw new RangeError('Downsample gain must be a positive finite number');
  }
  if (!Number.isSafeInteger(rawDelay) || rawDelay < 0) {
    throw new RangeError(
      'Downsample delay must be a non-negative safe integer',
    );
  }
  const rawBoundary: unknown = Reflect.get(plan, 'boundary');
  if (rawBoundary !== 'constant') {
    throw new RangeError('Only constant downsample boundaries are supported');
  }
};
