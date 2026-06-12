export const normalizePeak = (
  input: Float32Array<ArrayBuffer>,
  maxPeak = 0.9,
  minPeak?: number,
): Float32Array<ArrayBuffer> => {
  let peak = 0;
  for (const sample of input) {
    peak = Math.max(peak, Math.abs(sample));
  }

  const output = new Float32Array(input.length);
  if (peak === 0) {
    output.set(input);
    return output;
  }

  let scale = 1;
  if (peak > maxPeak) {
    scale = maxPeak / peak;
  } else if (minPeak !== undefined && peak < minPeak) {
    scale = minPeak / peak;
  }

  if (scale === 1) {
    output.set(input);
    return output;
  }

  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] * scale;
  }
  return output;
};

export const subtractPlanarStereo = (
  left: Float32Array<ArrayBuffer>,
  right: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(left.length);
  for (let i = 0; i < output.length; i++) {
    output[i] = left[i] - right[i];
  }
  return output;
};
