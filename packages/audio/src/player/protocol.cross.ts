import { createMessageChannel } from '@musetric/resource-utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/resource-utils/cross/messagePort';
import type { StemType } from '../common/stemType.es.js';

export const playerProcessorName = 'player-processor';

export type PlayerOutboundMethods = {
  boot: (message: { dataPort: MessagePort }) => void;
  play: () => void;
  pause: () => void;
  seek: (message: { frameIndex: number }) => void;
  setTransposeSemitones: (message: { transposeSemitones: number }) => void;
  setTempoRatio: (message: { tempoRatio: number }) => void;
  setTrackVolume: (message: { stemType: StemType; volume: number }) => void;
  setRecordingVolume: (message: { volume: number }) => void;
  startRecording: (message: {
    frameIndex: number;
    latencyFrameCount: number;
    samples: Float32Array<SharedArrayBuffer>;
    metadata: Int32Array<SharedArrayBuffer>;
    notificationPort: MessagePort;
  }) => void;
  seekRecording: (message: { frameIndex: number }) => void;
  flushRecording: () => void;
};

export type PlayerInboundMethods = {
  booted: () => void;
  setPlaying: (message: {
    playing: boolean;
    frameIndex: number;
    positionJump?: true;
  }) => void;
  setFrameIndex: (message: { frameIndex: number; positionJump?: true }) => void;
  recordingFlushed: (message: { sequence: number }) => void;
};

export const playerChannel = createMessageChannel<
  PlayerInboundMethods,
  PlayerOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setPlaying', 'setFrameIndex', 'recordingFlushed'],
  },
  outbound: {
    keys: [
      'boot',
      'play',
      'seek',
      'pause',
      'setTransposeSemitones',
      'setTempoRatio',
      'setTrackVolume',
      'setRecordingVolume',
      'startRecording',
      'seekRecording',
      'flushRecording',
    ],
    transfers: {
      boot: (message) => [message.dataPort],
      startRecording: (message) => [message.notificationPort],
    },
  },
});

export type PlayerDataMethods = {
  mount: (message: {
    frameCount: number;
    tracks: Record<StemType | 'recording', Float32Array<SharedArrayBuffer>[]>;
  }) => void;
  patchRecordingTrack: (message: {
    frameIndex: number;
    channels: Float32Array<ArrayBuffer>[];
  }) => void;
  unmount: () => void;
};

export const playerDataChannel = createMessageChannel<
  EmptyPortMethods,
  PlayerDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'patchRecordingTrack', 'unmount'],
  },
});
