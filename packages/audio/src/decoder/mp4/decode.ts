import { type DemuxedTrack } from './demux.js';

export type DecodedTrack = {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
};

export const decodeTrack = async (
  track: DemuxedTrack,
): Promise<DecodedTrack> => {
  const { decoderConfig, packets, sampleRate, numberOfChannels } = track;

  const support = await AudioDecoder.isConfigSupported(decoderConfig);
  if (!support.supported || !support.config) {
    throw new Error(`Unsupported AudioDecoder config: ${decoderConfig.codec}`);
  }

  const chunksByChannel: Float32Array<ArrayBuffer>[][] = Array.from(
    { length: numberOfChannels },
    () => [],
  );
  let frameCount = 0;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  let decodeError = undefined as Error | undefined;

  const decoder = new AudioDecoder({
    output: (audioData) => {
      for (
        let channelIndex = 0;
        channelIndex < numberOfChannels;
        channelIndex++
      ) {
        const chunk = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(chunk, {
          planeIndex: channelIndex,
          format: 'f32-planar',
        });
        chunksByChannel[channelIndex].push(chunk);
      }

      frameCount += audioData.numberOfFrames;
      audioData.close();
    },
    error: (error) => {
      decodeError = error;
    },
  });

  try {
    decoder.configure(support.config);

    for await (const packet of packets) {
      decoder.decode(packet.toEncodedAudioChunk());
    }

    await decoder.flush();
    if (decodeError) {
      throw decodeError;
    }
  } finally {
    decoder.close();
  }

  const channels = chunksByChannel.map((chunks) => {
    const result = new Float32Array(frameCount);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  });
  return { channels, sampleRate };
};
