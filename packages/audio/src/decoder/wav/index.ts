import { AudioSampleSink, BufferSource, Input, WAVE } from 'mediabunny';
import { resampleChannel } from '../resample.js';

export type DecodedWav = {
  channels: Float32Array<SharedArrayBuffer>[];
  frameCount: number;
};

const createSharedChannel = (samples: Float32Array) => {
  const shared = new SharedArrayBuffer(samples.byteLength);
  const sharedSamples = new Float32Array(shared);
  sharedSamples.set(samples);
  return sharedSamples;
};

const createEmptyDecodedWav = (): DecodedWav => {
  const sharedEmpty = createSharedChannel(new Float32Array(0));
  return { channels: [sharedEmpty, sharedEmpty], frameCount: 0 };
};

const collectChannels = async (
  sink: AudioSampleSink,
  channelCount: number,
): Promise<Float32Array[]> => {
  const chunksByChannel: Float32Array[][] = Array.from(
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

const toSharedStereo = (channels: Float32Array[]): DecodedWav => {
  if (channels.length === 0) {
    return createEmptyDecodedWav();
  }

  const [left, right = left] = channels;
  const sharedLeft = createSharedChannel(left);
  const sharedRight = createSharedChannel(right);

  return {
    channels: [sharedLeft, sharedRight],
    frameCount: sharedLeft.length,
  };
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
    const resampled = await Promise.all(
      channels.map(async (channel) =>
        resampleChannel(channel, track.sampleRate, sampleRate),
      ),
    );

    return toSharedStereo(resampled);
  } finally {
    input.dispose();
  }
};
