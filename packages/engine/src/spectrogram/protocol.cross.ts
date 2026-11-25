import { type SpectrogramConfig } from '@musetric/spectrogram';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import {
  pieceBuffers,
  type PlayerRecordingPiece,
  type PlayerStemLayout,
  recordingDataKeys,
  type RecordingDataMethods,
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

export type SpectrogramLeadPage = {
  index: number;
  startFrame: number;
  samples: Float32Array<ArrayBuffer>;
};

export type SpectrogramDataMethods = RecordingDataMethods & {
  mount: (message: {
    lead: PlayerStemLayout;
    recording: PlayerRecordingPiece[];
  }) => void;
  putLeadPage: (message: SpectrogramLeadPage) => void;
  unmount: () => void;
};

export type SpectrogramDataInboundMethods = {
  requestLeadPages: (message: { indices: number[] }) => void;
};

export const spectrogramDataChannel = createMessageChannel<
  SpectrogramDataInboundMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: ['requestLeadPages'],
  },
  outbound: {
    keys: ['mount', 'putLeadPage', 'unmount', ...recordingDataKeys],
    transfers: {
      mount: (message) => pieceBuffers(message.recording),
      putLeadPage: (message) => [message.samples.buffer],
      setRecordingPieces: (message) => pieceBuffers(message.pieces),
      appendLiveTake: (message) => [message.samples.buffer],
    },
  },
});
