import { createMessageChannel } from '@musetric/resource-utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/resource-utils/cross/messagePort';
import type { SpectrogramConfig } from './config.cross.js';

export type SpectrogramOutboundMethods = {
  boot: (message: { dataPort: MessagePort }) => void;
  mount: (message: {
    config: Partial<SpectrogramConfig>;
    trackProgress: number;
  }) => void;
  unmount: () => void;
  setTrackProgress: (message: { trackProgress: number }) => void;
  updateConfig: (message: { patch: Partial<SpectrogramConfig> }) => void;
};

export type SpectrogramInboundMethods = {
  booted: () => void;
  setState: (message: { status: 'pending' | 'error' | 'success' }) => void;
};

export const spectrogramChannel = createMessageChannel<
  SpectrogramInboundMethods,
  SpectrogramOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setState'],
  },
  outbound: {
    keys: ['boot', 'mount', 'unmount', 'setTrackProgress', 'updateConfig'],
    transfers: {
      boot: (message) => [message.dataPort],
      mount: (message) =>
        message.config.canvas ? [message.config.canvas] : [],
    },
  },
});

export type SpectrogramDataMethods = {
  mount: (message: {
    samples: Float32Array<SharedArrayBuffer>;
    recordingSamples: Float32Array<SharedArrayBuffer>;
  }) => void;
  unmount: () => void;
  recordingSamplesChanged: () => void;
};

export const spectrogramDataChannel = createMessageChannel<
  EmptyPortMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'unmount', 'recordingSamplesChanged'],
  },
});
