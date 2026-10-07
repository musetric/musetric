import { type SpectrogramConfig } from '@musetric/spectrogram';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';
import {
  pieceBuffers,
  type PlayerRecordingPiece,
  recordingDataKeys,
  type RecordingDataMethods,
} from '../player/protocol.cross.js';

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
