export const resampleChannel = async (
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Promise<Float32Array> => {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const { ConverterType, create } =
    await import('@alexanderolsen/libsamplerate-js');
  const src = await create(1, sourceSampleRate, targetSampleRate, {
    converterType: ConverterType.SRC_SINC_FASTEST,
  });

  try {
    return src.simple(samples);
  } finally {
    src.destroy();
  }
};
