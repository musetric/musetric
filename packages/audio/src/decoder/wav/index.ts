import { AudioSampleSink, BufferSource, Input, WAVE } from 'mediabunny';
import { resampleChannel } from '../resample.js';

export type DecodedWav = {
  channels: Float32Array<ArrayBuffer>[];
  frameCount: number;
};

const createEmptyDecodedWav = (): DecodedWav => ({
  channels: [new Float32Array(0)],
  frameCount: 0,
});
const collectChannels = async (
  sink: AudioSampleSink,
  channelCount: number,
): Promise<Float32Array<ArrayBuffer>[]> => {
  const chunksByChannel: Float32Array<ArrayBuffer>[][] = Array.from(
    { length: channelCount },
    () => [],
  );
  let frameCount = 0;

  for await (const sample of sink.samples()) {
    try {
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
        const chunk = new Float32Array(sample.numberOfFrames);
        sample.copyTo(chunk, {
          planeIndex: channelIndex,
          format: 'f32-planar',
        });
        chunksByChannel[channelIndex].push(chunk);
      }
      frameCount += sample.numberOfFrames;
    } finally {
      sample.close();
    }
  }

  return chunksByChannel.map((chunks) => {
    const channel = new Float32Array(frameCount);
    let offset = 0;
    for (const chunk of chunks) {
      channel.set(chunk, offset);
      offset += chunk.length;
    }
    return channel;
  });
};

export const decodeWav = async (
  buffer: ArrayBuffer,
  sampleRate: number,
): Promise<DecodedWav> => {
  if (buffer.byteLength === 0) {
    return createEmptyDecodedWav();
  }

  const input = new Input({
    formats: [WAVE],
    source: new BufferSource(buffer),
  });

  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      return createEmptyDecodedWav();
    }

    const channels = await collectChannels(
      new AudioSampleSink(track),
      track.numberOfChannels,
    );
    if (channels.length === 0) {
      return createEmptyDecodedWav();
    }

    const resampled = await Promise.all(
      channels.map(async (channel) =>
        resampleChannel(channel, track.sampleRate, sampleRate),
      ),
    );

    return { channels: resampled, frameCount: resampled[0].length };
  } finally {
    input.dispose();
  }
};
