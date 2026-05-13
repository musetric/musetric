import { resampleChannel } from '../resample.js';
import { decodeTrack } from './decode.js';
import { withDemuxedTrack } from './demux.js';

export type DecodedMp4 = {
  channels: Float32Array<SharedArrayBuffer>[];
  frameCount: number;
};
export const decodeMp4 = async (
  encodedBuffer: ArrayBuffer,
  sampleRate: number,
): Promise<DecodedMp4> => {
  const decoded = await withDemuxedTrack(encodedBuffer, decodeTrack);
  const resampled = await Promise.all(
    decoded.channels.map(async (channel) =>
      resampleChannel(channel, decoded.sampleRate, sampleRate),
    ),
  );
  const channels = resampled.map((channel) => {
    const shared = new SharedArrayBuffer(channel.byteLength);
    const sharedChannel = new Float32Array(shared);
    sharedChannel.set(channel);
    return sharedChannel;
  });
  const frameCount = channels[0].length;

  return {
    channels,
    frameCount,
  };
};
