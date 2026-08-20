import { resampleChannel } from '../resample.js';
import { decodeTrack } from './decode.js';
import { withDemuxedTrack } from './demux.js';

export type DecodedMp4 = {
  channels: Float32Array<ArrayBuffer>[];
  frameCount: number;
};
export const decodeMp4 = async (
  encodedBuffer: ArrayBuffer,
  sampleRate: number,
): Promise<DecodedMp4> => {
  const decoded = await withDemuxedTrack(encodedBuffer, decodeTrack);
  const channels = await Promise.all(
    decoded.channels.map(async (channel) =>
      resampleChannel(channel, decoded.sampleRate, sampleRate),
    ),
  );
  const frameCount = channels[0].length;

  return {
    channels,
    frameCount,
  };
};
