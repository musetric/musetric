import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type NativeMicrophoneChunk = {
  frame: number;
  samples: Float32Array;
};

export type NativeMicrophoneInboundMethods = {
  ready: () => void;
};

export type NativeMicrophoneOutboundMethods = {
  push: (message: NativeMicrophoneChunk) => void;
  reset: () => void;
};

export const nativeMicrophoneChannel = createMessageChannel<
  NativeMicrophoneInboundMethods,
  NativeMicrophoneOutboundMethods
>({
  inbound: {
    keys: ['ready'],
  },
  outbound: {
    transfers: {
      push: (message) => [message.samples.buffer],
    },
    keys: ['push', 'reset'],
  },
});

export const nativeMicrophoneProcessorName = 'native-microphone-processor';

export const nativeMicrophoneDelaySeconds = 0.08;
