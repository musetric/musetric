export const decodeMonoAudio = async (
  data: ArrayBuffer,
  sampleRate: number,
): Promise<Float32Array> => {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const buffer = await context.decodeAudioData(data);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const [first] = channels;
  if (channels.length === 1) {
    return Float32Array.from(first);
  }
  const mono = new Float32Array(buffer.length);
  const weight = 1 / channels.length;
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i += 1) {
      mono[i] += channel[i] * weight;
    }
  }
  return mono;
};
