import { type StemType } from '@musetric/audio/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type StemPagesOpen = {
  projectId: number;
  stem: StemType;
  sampleRate: number;
};

export type StemPagesInfo = {
  frameCount: number;
  channelCount: number;
  pageStarts: number[];
};

export type StemPageRequest = {
  id: number;
  index: number;
  mono: boolean;
};

export type StemPageSamples = {
  id: number;
  index: number;
  startFrame: number;
  frameCount: number;
  samples: Float32Array<ArrayBuffer>;
};

export type StemPagesOutboundMethods = {
  open: (message: StemPagesOpen) => void;
  read: (message: StemPageRequest) => void;
};

export type StemPagesInboundMethods = {
  opened: (message: StemPagesInfo) => void;
  page: (message: StemPageSamples) => void;
  failed: (message: { id?: number; reason: string }) => void;
};

export const stemPagesChannel = createMessageChannel<
  StemPagesInboundMethods,
  StemPagesOutboundMethods
>({
  inbound: {
    keys: ['opened', 'page', 'failed'],
    transfers: {
      page: (message) => [message.samples.buffer],
    },
  },
  outbound: {
    keys: ['open', 'read'],
  },
});
