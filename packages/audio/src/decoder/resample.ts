export const resampleChannel = async (
  samples: Float32Array<ArrayBuffer>,
  sourceSampleRate: number,
  targetSampleRate: number,
): Promise<Float32Array<ArrayBuffer>> => {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const { ConverterType, create } =
    await import('@alexanderolsen/libsamplerate-js');
  const src = await create(1, sourceSampleRate, targetSampleRate, {
    converterType: ConverterType.SRC_SINC_FASTEST,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return src.simple(samples) as Float32Array<ArrayBuffer>;
  } finally {
    src.destroy();
  }
};
