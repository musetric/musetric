import init, { Decoder } from '@musetric/dsp/decode';

const toPlanar = (
  chunks: Float32Array[],
  channelCount: number,
  frameCount: number,
): Float32Array<ArrayBuffer>[] => {
  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(frameCount),
  );
  let offset = 0;
  for (const chunk of chunks) {
    const frames = chunk.length / channelCount;
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < channelCount; channel++) {
        channels[channel][offset + frame] =
          chunk[frame * channelCount + channel];
      }
    }
    offset += frames;
  }
  return channels;
};

export type DecodedAudio = {
  channels: Float32Array<ArrayBuffer>[];
  frameCount: number;
};

export type DecodeOptions = {
  extension: string;
  sampleRate: number;
  keepChannels: boolean;
};

export type AudioDecoder = {
  decode: (
    buffer: ArrayBuffer,
    options: DecodeOptions,
  ) => Promise<DecodedAudio>;
};

export const createAudioDecoder = (): AudioDecoder => {
  let loading: ReturnType<typeof init> | undefined = undefined;
  return {
    decode: async (buffer, options) => {
      loading ??= init();
      await loading;
      const decoder = new Decoder(
        new Uint8Array(buffer),
        options.extension,
        options.sampleRate,
        options.keepChannels,
      );
      try {
        const channelCount = decoder.channels;
        const chunks: Float32Array[] = [];
        let frameCount = 0;
        for (let chunk = decoder.read(); chunk; chunk = decoder.read()) {
          chunks.push(chunk);
          frameCount += chunk.length / channelCount;
        }
        return {
          channels: toPlanar(chunks, channelCount, frameCount),
          frameCount,
        };
      } finally {
        decoder.free();
      }
    },
  };
};
