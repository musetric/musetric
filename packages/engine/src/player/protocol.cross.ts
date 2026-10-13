import { type StemType } from '@musetric/audio/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

export const playerProcessorName = 'player-processor';

export type PlayerRange = {
  fromFrame: number;
  toFrame: number;
};

export type PlayerRangeRepeat = 'cycle' | 'once';

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
  setVoiceOctave: (message: { voiceOctave: number; shifted: boolean }) => void;
  setTempoRatio: (message: { tempoRatio: number }) => void;
  setTrackVolume: (message: { stemType: StemType; volume: number }) => void;
  setRecordingVolume: (message: { volume: number }) => void;
  setMetronome: (message: {
    beatsInSamples: Int32Array;
    downbeatMask: Uint8Array;
    enabled: boolean;
    volume: number;
  }) => void;
  setRange: (message: {
    range?: PlayerRange;
    repeat: PlayerRangeRepeat;
    stopFrame?: number;
  }) => void;
  startRecording: (message: {
    frameIndex: number;
    revision: number;
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
    notificationPort: MessagePort;
    pass?: boolean;
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
  recordingPassStarted: () => void;
  recordingPassEnded: (message: { complete: boolean }) => void;
};

export const playerChannel = createMessageChannel<
  PlayerInboundMethods,
  PlayerOutboundMethods
>({
  inbound: {
    keys: [
      'booted',
      'setPlaying',
      'recordingFlushed',
      'recordingPassStarted',
      'recordingPassEnded',
    ],
  },
  outbound: {
    keys: [
      'boot',
      'play',
      'seek',
      'stop',
      'setFrozen',
      'setTransposeSemitones',
      'setVoiceOctave',
      'setTempoRatio',
      'setTrackVolume',
      'setRecordingVolume',
      'setMetronome',
      'setRange',
      'startRecording',
      'flushRecording',
    ],
    transfers: {
      boot: (message) => [message.dataPort, ...message.playheadPorts],
      startRecording: (message) => [message.notificationPort],
    },
  },
});

export type PlayerRecordingPiece = {
  songStartFrame: number;
  tempo: number;
  transpose: number;
  octave: number;
  samples: Float32Array<ArrayBuffer>;
};

export const pieceBuffers = (pieces: PlayerRecordingPiece[]) =>
  pieces.map((piece) => piece.samples.buffer);

export const recordingDataKeys = [
  'setRecordingPieces',
  'beginLiveTake',
  'appendLiveTake',
] as const;

export type PlayerTracks = Record<StemType, Float32Array<ArrayBuffer>[]>;

export type LiveTakeStart = {
  takeId: string;
  tempo: number;
  transpose: number;
  octave: number;
};

export type LiveTakeChunk = {
  startFrame: number;
  offset: number;
  samples: Float32Array<ArrayBuffer>;
};

export type RecordingPiecesUpdate = {
  pieces: PlayerRecordingPiece[];
  finishedTakeId?: string;
  switched?: boolean;
};

export type RecordingDataMethods = {
  setRecordingPieces: (message: RecordingPiecesUpdate) => void;
  beginLiveTake: (message: LiveTakeStart) => void;
  appendLiveTake: (message: LiveTakeChunk) => void;
};

export type PlayerDataMethods = RecordingDataMethods & {
  mount: (message: {
    frameCount: number;
    tracks: PlayerTracks;
    recording: PlayerRecordingPiece[];
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
    keys: ['mount', 'unmount', ...recordingDataKeys],
    transfers: {
      mount: (message) => [
        ...Object.values(message.tracks).flatMap((channels) =>
          channels.map((channel) => channel.buffer),
        ),
        ...pieceBuffers(message.recording),
      ],
      setRecordingPieces: (message) => pieceBuffers(message.pieces),
      appendLiveTake: (message) => [message.samples.buffer],
    },
  },
});
