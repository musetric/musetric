import { type DecodedAudio } from '@musetric/audio/decoder';
import { type StemType } from '@musetric/audio/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type StemDecodeRequest = {
  projectId: number;
  stem: StemType;
  sampleRate: number;
};

export type StemDecodeOutboundMethods = {
  decode: (message: StemDecodeRequest) => void;
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
  },
});
