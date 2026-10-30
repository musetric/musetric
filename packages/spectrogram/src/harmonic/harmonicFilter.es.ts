const cutoffRatio = 0.25;
const filterStages = 3;
const voicingFadeSeconds = 0.02;

export type HarmonicFilter = {
  setHarmonics: (harmonics: readonly number[]) => void;
  reset: () => void;
  process: (
    fundamental: number,
    input: ArrayLike<number>,
    output: Float32Array,
  ) => void;
};

export const createHarmonicFilter = (
  sampleRate: number,
  channelCount: number,
): HarmonicFilter => {
  const fadeStep = 1 - Math.exp(-1 / (voicingFadeSeconds * sampleRate));
  const stateStride = filterStages * 2;
  let harmonics: number[] = [];
  let states = new Float64Array(0);
  let phase = 0;
  let gain = 0;
  let smoothing = 0;

  const reset = () => {
    states.fill(0);
    phase = 0;
    gain = 0;
  };

  return {
    setHarmonics: (next) => {
      harmonics = [...next];
      states = new Float64Array(harmonics.length * channelCount * stateStride);
      reset();
    },
    reset,
    process: (fundamental, input, output) => {
      if (fundamental > 0) {
        phase =
          (phase + (2 * Math.PI * fundamental) / sampleRate) % (2 * Math.PI);
        smoothing =
          1 - Math.exp((-2 * Math.PI * cutoffRatio * fundamental) / sampleRate);
      }
      gain += ((fundamental > 0 ? 1 : 0) - gain) * fadeStep;
      output.fill(0);
      harmonics.forEach((harmonic, harmonicIndex) => {
        const cosine = Math.cos(harmonic * phase);
        const sine = Math.sin(harmonic * phase);
        for (let channel = 0; channel < channelCount; channel += 1) {
          const base = (harmonicIndex * channelCount + channel) * stateStride;
          let real = input[channel] * cosine;
          let imaginary = -input[channel] * sine;
          for (let stage = 0; stage < filterStages; stage += 1) {
            const index = base + stage * 2;
            states[index] += smoothing * (real - states[index]);
            states[index + 1] += smoothing * (imaginary - states[index + 1]);
            real = states[index];
            imaginary = states[index + 1];
          }
          output[channel] += 2 * gain * (real * cosine - imaginary * sine);
        }
      });
    },
  };
};
