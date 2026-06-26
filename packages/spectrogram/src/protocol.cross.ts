import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';
import { type SpectrogramConfig, type TrackKey } from './config.cross.js';

// Shared playback position written by the player worklet. Slot 0 holds the
// current frameIndex (see playhead.cross.ts in @musetric/audio for the layout).
// The worker polls it instead of receiving a setTrackProgress postMessage per
// frame while playing.
export type SpectrogramPlayhead = Int32Array<SharedArrayBuffer>;

export type SpectrogramOutboundMethods = {
  boot: (message: {
    dataPort: MessagePort;
    playhead: SpectrogramPlayhead;
  }) => void;
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
      boot: (message) => [message.dataPort],
      mount: (message) =>
        message.config.canvas ? [message.config.canvas] : [],
    },
  },
});

export type SpectrogramLaneSamples = Partial<
  Record<TrackKey, Float32Array<SharedArrayBuffer>>
>;

export type SpectrogramDataMethods = {
  mount: (message: { samples: SpectrogramLaneSamples }) => void;
  unmount: () => void;
  samplesChanged: (message: { trackKey: TrackKey }) => void;
};

export const spectrogramDataChannel = createMessageChannel<
  EmptyPortMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'unmount', 'samplesChanged'],
  },
});
