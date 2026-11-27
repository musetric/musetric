import { type SpectrogramConfig } from '@musetric/spectrogram';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import {
  type PlayerStemLayout,
  type PlayerTakeTrack,
} from '../player/protocol.cross.js';
import { type CapturedPreview } from './livePreview.cross.js';

export type SpectrogramViewWindow = {
  startFrame: number;
  frameCount: number;
};

export type SpectrogramOutboundMethods = {
  boot: (message: {
    dataPort: MessagePort;
    sampleRate: number;
    captureModule: WebAssembly.Module;
  }) => void;
  connectPlayhead: (message: { playheadPort: MessagePort }) => void;
  mount: (message: {
    config: Partial<SpectrogramConfig>;
    trackProgress: number;
  }) => void;
  unmount: () => void;
  setTrackProgress: (message: {
    trackProgress: number;
    revision: number;
  }) => void;
  setFrameCount: (message: { frameCount: number }) => void;
  setPlaying: (message: { playing: boolean }) => void;
  updateConfig: (message: { patch: Partial<SpectrogramConfig> }) => void;
  setViewWindow: (message: { window?: SpectrogramViewWindow }) => void;
  previewLiveTake: (message: CapturedPreview) => void;
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
      'connectPlayhead',
      'mount',
      'unmount',
      'setTrackProgress',
      'setFrameCount',
      'setPlaying',
      'updateConfig',
      'setViewWindow',
      'previewLiveTake',
    ],
    transfers: {
      boot: (message) => [message.dataPort],
      connectPlayhead: (message) => [message.playheadPort],
      previewLiveTake: (message) => [message.samples.buffer],
      mount: (message) =>
        message.config.canvas ? [message.config.canvas] : [],
    },
  },
});

export const spectrogramLeadKey = 'lead';

export type SpectrogramTake = Omit<PlayerTakeTrack, 'track' | 'sounding'> & {
  key: string;
};

export type SpectrogramTakes = {
  takes: SpectrogramTake[];
  live?: string;
};

export type SpectrogramPage = {
  key: string;
  index: number;
  samples: Float32Array<ArrayBuffer>;
};

export type SpectrogramDataMethods = {
  mount: (message: SpectrogramTakes & { lead: PlayerStemLayout }) => void;
  setTakes: (message: SpectrogramTakes) => void;
  putPage: (message: SpectrogramPage) => void;
  writeLiveTake: (message: {
    offset: number;
    samples: Float32Array<ArrayBuffer>;
  }) => void;
  unmount: () => void;
};

export type SpectrogramDataInboundMethods = {
  requestPages: (message: { key: string; indices: number[] }) => void;
};

export const spectrogramDataChannel = createMessageChannel<
  SpectrogramDataInboundMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: ['requestPages'],
  },
  outbound: {
    keys: ['mount', 'setTakes', 'putPage', 'writeLiveTake', 'unmount'],
    transfers: {
      putPage: (message) => [message.samples.buffer],
      writeLiveTake: (message) => [message.samples.buffer],
    },
  },
});
