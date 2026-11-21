import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type NativeMicrophoneChunk = {
  frame: number;
  sampleRate: number;
  samples: Float32Array;
};

export type NativeMicrophoneInboundMethods = {
  ready: () => void;
};

export type MicrophoneBoot = {
  captureModule: WebAssembly.Module;
};

export type NativeMicrophoneOutboundMethods = {
  boot: (message: MicrophoneBoot) => void;
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
    keys: ['boot', 'push', 'reset'],
  },
});

export const nativeMicrophoneProcessorName = 'native-microphone-processor';

export const nativeMicrophoneDelaySeconds = 0.08;

export type TimedMicrophoneChunk = {
  frame: number;
  at: number;
  sampleRate: number;
  samples: Float32Array;
};

export type TimedMicrophoneInboundMethods = {
  ready: () => void;
};

export type TimedMicrophoneOutboundMethods = {
  boot: (message: MicrophoneBoot) => void;
  push: (message: TimedMicrophoneChunk) => void;
};

export const timedMicrophoneChannel = createMessageChannel<
  TimedMicrophoneInboundMethods,
  TimedMicrophoneOutboundMethods
>({
  inbound: {
    keys: ['ready'],
  },
  outbound: {
    transfers: {
      push: (message) => [message.samples.buffer],
    },
    keys: ['boot', 'push'],
  },
});

export const timedMicrophoneProcessorName = 'timed-microphone-processor';
