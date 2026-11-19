import { type DecodedAudio, type DecodeOptions } from '@musetric/audio/decoder';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type StemDecodeOutboundMethods = {
  decode: (message: { buffer: ArrayBuffer; options: DecodeOptions }) => void;
};

export type StemDecodeInboundMethods = {
  decoded: (message: DecodedAudio) => void;
  failed: (message: { reason: string }) => void;
};

export const stemDecodeChannel = createMessageChannel<
  StemDecodeInboundMethods,
  StemDecodeOutboundMethods
>({
  inbound: {
    keys: ['decoded', 'failed'],
    transfers: {
      decoded: (message) => message.channels.map((channel) => channel.buffer),
    },
  },
  outbound: {
    keys: ['decode'],
    transfers: {
      decode: (message) => [message.buffer],
    },
  },
});
