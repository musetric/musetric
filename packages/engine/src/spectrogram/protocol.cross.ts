import { type SpectrogramConfig, type TrackKey } from '@musetric/spectrogram';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export type SpectrogramOutboundMethods = {
  boot: (message: { dataPort: MessagePort; playheadPort: MessagePort }) => void;
  mount: (message: {
    config: Partial<SpectrogramConfig>;
    trackProgress: number;
  }) => void;
  unmount: () => void;
  setTrackProgress: (message: { trackProgress: number }) => void;
  setFrameCount: (message: { frameCount: number }) => void;
  setPlaying: (message: { playing: boolean }) => void;
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
    keys: [
      'boot',
      'mount',
      'unmount',
      'setTrackProgress',
      'setFrameCount',
      'setPlaying',
      'updateConfig',
    ],
    transfers: {
      boot: (message) => [message.dataPort, message.playheadPort],
      mount: (message) =>
        message.config.canvas ? [message.config.canvas] : [],
    },
  },
});

export type SpectrogramLaneSamples = Partial<
  Record<TrackKey, Float32Array<ArrayBuffer>>
>;

export type SpectrogramDataMethods = {
  mount: (message: { samples: SpectrogramLaneSamples }) => void;
  unmount: () => void;
  patchSamples: (message: {
    trackKey: TrackKey;
    frameIndex: number;
    samples: Float32Array<ArrayBuffer>;
  }) => void;
};

export const spectrogramDataChannel = createMessageChannel<
  EmptyPortMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'unmount', 'patchSamples'],
    transfers: {
      mount: (message) =>
        Object.values(message.samples).map((samples) => samples.buffer),
      patchSamples: (message) => [message.samples.buffer],
    },
  },
});
