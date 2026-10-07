const headerByteLength = 44;
const bytesPerSample = 2;

const writeText = (view: DataView, offset: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
};

const toPcm = (sample: number): number => {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.trunc(clamped < 0 ? clamped * 32768 : clamped * 32767);
};

export const encodeMonoWav = (
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer => {
  const dataByteLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(buffer);
  writeText(view, 0, 'RIFF');
  view.setUint32(4, headerByteLength - 8 + dataByteLength, true);
  writeText(view, 8, 'WAVE');
  writeText(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);
  samples.forEach((sample, index) => {
    view.setInt16(
      headerByteLength + index * bytesPerSample,
      toPcm(sample),
      true,
    );
  });
  return buffer;
};
