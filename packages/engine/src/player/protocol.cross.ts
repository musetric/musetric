import { type StemType } from '@musetric/audio/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export const playerProcessorName = 'player-processor';

export type PlayerOutboundMethods = {
  boot: (message: {
    dataPort: MessagePort;
    playheadPorts: MessagePort[];
  }) => void;
  play: (message: {
    revision: number;
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
  }) => void;
  stop: (message: { revision: number }) => void;
  setFrozen: (message: { frozen: boolean }) => void;
  seek: (message: { frameIndex: number; revision: number }) => void;
  setTransposeSemitones: (message: { transposeSemitones: number }) => void;
  setTempoRatio: (message: { tempoRatio: number }) => void;
  setTrackVolume: (message: { stemType: StemType; volume: number }) => void;
  setRecordingVolume: (message: { volume: number }) => void;
  setMetronome: (message: {
    beatsInSamples: Int32Array;
    downbeatMask: Uint8Array;
    enabled: boolean;
    volume: number;
  }) => void;
  startRecording: (message: {
    frameIndex: number;
    revision: number;
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
    notificationPort: MessagePort;
  }) => void;
  flushRecording: () => void;
};

export type PlayerInboundMethods = {
  booted: () => void;
  setPlaying: (message: {
    playing: boolean;
    frameIndex: number;
    revision: number;
    positionJump?: true;
  }) => void;
  recordingFlushed: (message: { sequence: number }) => void;
};

export const playerChannel = createMessageChannel<
  PlayerInboundMethods,
  PlayerOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setPlaying', 'recordingFlushed'],
  },
  outbound: {
    keys: [
      'boot',
      'play',
      'seek',
      'stop',
      'setFrozen',
      'setTransposeSemitones',
      'setTempoRatio',
      'setTrackVolume',
      'setRecordingVolume',
      'setMetronome',
      'startRecording',
      'flushRecording',
    ],
    transfers: {
      boot: (message) => [message.dataPort, ...message.playheadPorts],
      startRecording: (message) => [message.notificationPort],
    },
  },
});

export type PlayerTracks = Record<
  StemType | 'recording',
  Float32Array<ArrayBuffer>[]
>;

export type PlayerDataMethods = {
  mount: (message: { frameCount: number; tracks: PlayerTracks }) => void;
  unmount: () => void;
  patchRecording: (message: {
    frameIndex: number;
    samples: Float32Array<ArrayBuffer>;
  }) => void;
};

export const playerDataChannel = createMessageChannel<
  EmptyPortMethods,
  PlayerDataMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['mount', 'unmount', 'patchRecording'],
    transfers: {
      mount: (message) =>
        Object.values(message.tracks).flatMap((channels) =>
          channels.map((channel) => channel.buffer),
        ),
      patchRecording: (message) => [message.samples.buffer],
    },
  },
});
