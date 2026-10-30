import {
  type SpectrogramConfig,
  type SpectrogramCursorHarmonics,
  type TakeVersion,
  type VocalMark,
} from '@musetric/spectrogram';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';
import {
  pieceBuffers,
  type PlayerRecordingPiece,
  recordingDataKeys,
  type RecordingDataMethods,
} from '../player/protocol.cross.js';

export type SpectrogramViewWindow = {
  startFrame: number;
  frameCount: number;
};

export type VocalCoachStatus = 'idle' | 'analyzing' | 'ready';

export type VocalCoachUpdate = {
  status: VocalCoachStatus;
  marks: VocalMark[];
};

export type SpectrogramOutboundMethods = {
  boot: (message: {
    dataPort: MessagePort;
    playheadPort: MessagePort;
    sampleRate: number;
    fundamentalPort: MessagePort;
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
  setViewWindow: (message: { window?: SpectrogramViewWindow }) => void;
  previewLiveTake: (message: {
    capturedAt: number;
    samples: Float32Array<ArrayBuffer>;
  }) => void;
  setHarmonicFilter: (message: { harmonics: number[] }) => void;
  setVocalCoach: (message: { enabled: boolean }) => void;
  renderTakeVersion: (message: {
    requestId: number;
    start: number;
    end: number;
    version: TakeVersion;
  }) => void;
};

export type SpectrogramInboundMethods = {
  booted: () => void;
  setState: (message: { status: 'pending' | 'error' | 'success' }) => void;
  setCursorHarmonics: (message: {
    harmonics: SpectrogramCursorHarmonics;
  }) => void;
  setVocalMarks: (message: VocalCoachUpdate) => void;
  setTakeVersion: (message: {
    requestId: number;
    samples?: Float32Array<ArrayBuffer>;
  }) => void;
};

export const spectrogramChannel = createMessageChannel<
  SpectrogramInboundMethods,
  SpectrogramOutboundMethods
>({
  inbound: {
    keys: [
      'booted',
      'setState',
      'setCursorHarmonics',
      'setVocalMarks',
      'setTakeVersion',
    ],
    transfers: {
      setTakeVersion: (message) =>
        message.samples ? [message.samples.buffer] : [],
    },
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
      'setViewWindow',
      'previewLiveTake',
      'setHarmonicFilter',
      'setVocalCoach',
      'renderTakeVersion',
    ],
    transfers: {
      boot: (message) => [
        message.dataPort,
        message.playheadPort,
        message.fundamentalPort,
      ],
      previewLiveTake: (message) => [message.samples.buffer],
      mount: (message) =>
        message.config.canvas ? [message.config.canvas] : [],
    },
  },
});

export type SpectrogramDataMethods = RecordingDataMethods & {
  mount: (message: {
    lead: Float32Array<ArrayBuffer>;
    recording: PlayerRecordingPiece[];
  }) => void;
  unmount: () => void;
};

export const spectrogramDataChannel = createMessageChannel<
  EmptyPortMethods,
  SpectrogramDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'unmount', ...recordingDataKeys],
    transfers: {
      mount: (message) => [
        message.lead.buffer,
        ...pieceBuffers(message.recording),
      ],
      setRecordingPieces: (message) => pieceBuffers(message.pieces),
      appendLiveTake: (message) => [message.samples.buffer],
    },
  },
});
