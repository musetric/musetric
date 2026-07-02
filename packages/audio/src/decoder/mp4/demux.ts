import { assertDefined } from '@musetric/utils';
import {
  BufferSource,
  type EncodedPacket,
  EncodedPacketSink,
  Input,
  MP4,
} from 'mediabunny';

export type DemuxedTrack = {
  decoderConfig: AudioDecoderConfig;
  packets: AsyncGenerator<EncodedPacket, void, unknown>;
  sampleRate: number;
  numberOfChannels: number;
};

export const demuxTrack = async (input: Input): Promise<DemuxedTrack> => {
  const audioTrack = assertDefined(
    await input.getPrimaryAudioTrack(),
    'Unsupported fMP4: audio track not found',
  );

  const { numberOfChannels } = audioTrack;
  if (numberOfChannels < 1) {
    throw new Error('Unsupported fMP4: audio track has no channels');
  }

  const decoderConfig = assertDefined(
    await audioTrack.getDecoderConfig(),
    'Unsupported fMP4: missing audio decoder config',
  );

  const { codec } = decoderConfig;
  if (!codec.startsWith('mp4a.40.')) {
    throw new Error(`Unsupported fMP4 codec: ${codec}`);
  }

  const packetSink = new EncodedPacketSink(audioTrack);
  const packets = packetSink.packets();

  return {
    decoderConfig,
    packets,
    sampleRate: audioTrack.sampleRate,
    numberOfChannels,
  };
};

export const withDemuxedTrack = async <Result>(
  encodedBuffer: ArrayBuffer,
  callback: (demuxed: DemuxedTrack) => Promise<Result> | Result,
): Promise<Result> => {
  const input = new Input({
    formats: [MP4],
    source: new BufferSource(encodedBuffer),
  });

  try {
    const track = await demuxTrack(input);
    return await callback(track);
  } finally {
    input.dispose();
  }
};
