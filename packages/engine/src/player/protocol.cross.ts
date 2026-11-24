import { type StemType } from '@musetric/audio/es';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

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
    stretchModule: WebAssembly.Module;
  }) => void;
  play: (message: {
    command: number;
    revision: number;
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
  }) => void;
  stop: (message: {
    command: number;
    revision: number;
    frameIndex: number;
  }) => void;
  setFrozen: (message: { command: number; frozen: boolean }) => void;
  seek: (message: {
    command: number;
    frameIndex: number;
    revision: number;
  }) => void;
  setLatency: (message: {
    latencyFrameCount: number;
    inputLatencyFrameCount: number;
  }) => void;
  setOutputClock: (message: { clockOffset: number }) => void;
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
    command: number;
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

export type PlayerMotion = 'stopped' | 'rolling' | 'held' | 'buffering';

export type PlayerInboundMethods = {
  booted: () => void;
  setPlaying: (message: {
    command: number;
    playing: boolean;
    motion: PlayerMotion;
    frameIndex: number;
    revision: number;
    positionJump?: true;
    glide?: true;
  }) => void;
  recordingFlushed: (message: { sequence: number }) => void;
  recordingPassStarted: () => void;
  recordingPassEnded: (message: { complete: boolean }) => void;
  failed: (message: { reason: string }) => void;
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
      'failed',
    ],
  },
  outbound: {
    keys: [
      'boot',
      'play',
      'seek',
      'setLatency',
      'setOutputClock',
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

export type PlayerStemLayout = {
  frameCount: number;
  pageStarts: number[];
};

export type PlayerStemLayouts = Record<StemType, PlayerStemLayout>;

export type PlayerPage = {
  stem: StemType;
  index: number;
  frameCount: number;
  channelCount: number;
  samples: Float32Array<ArrayBuffer>;
};

export type PlayerPageKey = {
  stem: StemType;
  index: number;
};

export type PlayerWindow = {
  frameIndex: number;
  loop?: PlayerRange;
};

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
    layouts: PlayerStemLayouts;
    residentPageLimit: number;
    recording: PlayerRecordingPiece[];
  }) => void;
  putPage: (message: PlayerPage) => void;
  dropPages: (message: { pages: PlayerPageKey[] }) => void;
  unmount: () => void;
};

export type PlayerDataInboundMethods = {
  requestWindow: (message: PlayerWindow) => void;
};

export const playerDataChannel = createMessageChannel<
  PlayerDataInboundMethods,
  PlayerDataMethods
>({
  inbound: {
    keys: ['requestWindow'],
  },
  outbound: {
    keys: ['mount', 'putPage', 'dropPages', 'unmount', ...recordingDataKeys],
    transfers: {
      mount: (message) => pieceBuffers(message.recording),
      putPage: (message) => [message.samples.buffer],
      setRecordingPieces: (message) => pieceBuffers(message.pieces),
      appendLiveTake: (message) => [message.samples.buffer],
    },
  },
});
