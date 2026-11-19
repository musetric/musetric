import init, { Decoder, FlacFeed } from '@musetric/dsp';

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

const createPlanarSink = (feed: FlacFeed) => {
  let channels: Float32Array<ArrayBuffer>[] = [];
  let frameCount = 0;
  return {
    write: (samples: Float32Array) => {
      if (samples.length === 0) {
        return;
      }
      if (channels.length === 0) {
        const capacity = feed.frameCount;
        const channelCount = feed.channels;
        if (capacity === undefined || channelCount === undefined) {
          throw new Error('The flac stream declares no frame count');
        }
        channels = Array.from(
          { length: channelCount },
          () => new Float32Array(capacity),
        );
      }
      const channelCount = channels.length;
      const frames = Math.min(
        samples.length / channelCount,
        channels[0].length - frameCount,
      );
      for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
          channels[channel][frameCount + frame] =
            samples[frame * channelCount + channel];
        }
      }
      frameCount += frames;
    },
    finish: (): DecodedAudio => ({
      channels: channels.map((channel) =>
        channel.length === frameCount ? channel : channel.slice(0, frameCount),
      ),
      frameCount,
    }),
  };
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
  decodeFlacStream: (
    stream: ReadableStream<Uint8Array>,
    sampleRate: number,
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
    decodeFlacStream: async (stream, sampleRate) => {
      loading ??= init();
      await loading;
      const feed = new FlacFeed(sampleRate);
      const reader = stream.getReader();
      const sink = createPlanarSink(feed);
      try {
        let read = await reader.read();
        while (!read.done) {
          sink.write(feed.push(read.value));
          read = await reader.read();
        }
        sink.write(feed.finish());
        return sink.finish();
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
        feed.free();
      }
    },
  };
};
