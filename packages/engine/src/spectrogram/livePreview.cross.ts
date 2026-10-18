export const toContextRate = (
  samples: Float32Array,
  sampleRate: number,
  contextSampleRate: number,
): Float32Array<ArrayBuffer> => {
  if (sampleRate === contextSampleRate) {
    return samples.slice();
  }
  const step = sampleRate / contextSampleRate;
  const last = samples.length - 1;
  const result = new Float32Array(Math.round(samples.length / step));
  for (let index = 0; index < result.length; index += 1) {
    const at = Math.min(last, index * step);
    const before = Math.floor(at);
    const after = Math.min(last, before + 1);
    result[index] =
      samples[before] + (samples[after] - samples[before]) * (at - before);
  }
  return result;
};
