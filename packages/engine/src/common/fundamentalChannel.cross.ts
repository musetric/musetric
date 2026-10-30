import { type TrackKey } from '@musetric/spectrogram/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export type FundamentalFramesMethods = {
  setFundamentalFrames: (message: {
    trackKey: TrackKey;
    firstFrame: number;
    hopSeconds: number;
    values: Float32Array<ArrayBuffer>;
  }) => void;
};

export const fundamentalChannel = createMessageChannel<
  EmptyPortMethods,
  FundamentalFramesMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['setFundamentalFrames'],
    transfers: {
      setFundamentalFrames: (message) => [message.values.buffer],
    },
  },
});
