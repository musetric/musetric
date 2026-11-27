import { type StemType } from '@musetric/audio/es';
import { type PlayerMotion, type PlayerRangeRepeat } from '@musetric/transport';
import { createSyncMessageChannel } from '@musetric/utils/cross/messageChannel';

export const playerProcessorName = 'player-processor';

export type PlayerRange = {
  fromFrame: number;
  toFrame: number;
};

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
  mounted: () => void;
  failed: (message: { reason: string }) => void;
};

export const playerChannel = createSyncMessageChannel<
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
      'mounted',
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

export const stemTracks: Record<StemType, number> = {
  lead: 0,
  backing: 1,
  instrumental: 2,
};

export type PlayerStemLayout = {
  frameCount: number;
  pageStarts: number[];
};

export type PlayerTakeTrack = PlayerStemLayout & {
  track: number;
  songStartFrame: number;
  tempo: number;
  transpose: number;
  octave: number;
  sounding: boolean;
};

export type PlayerTakes = {
  takes: PlayerTakeTrack[];
  residentPageLimit: number;
};

export type PlayerPage = {
  track: number;
  index: number;
  frameCount: number;
  channelCount: number;
  samples: Float32Array<ArrayBuffer>;
};

export type PlayerPageKey = {
  track: number;
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

export type PlayerStemLayouts = Record<StemType, PlayerStemLayout>;

export type PlayerDataMethods = {
  mount: (
    message: PlayerTakes & {
      frameCount: number;
      layouts: PlayerStemLayouts;
    },
  ) => void;
  setTakes: (message: PlayerTakes) => void;
  putPage: (message: PlayerPage) => void;
  dropPages: (message: { pages: PlayerPageKey[] }) => void;
  unmount: () => void;
};

export type PlayerDataInboundMethods = {
  requestWindow: (message: PlayerWindow) => void;
};

export const playerDataChannel = createSyncMessageChannel<
  PlayerDataInboundMethods,
  PlayerDataMethods
>({
  inbound: {
    keys: ['requestWindow'],
  },
  outbound: {
    keys: ['mount', 'setTakes', 'putPage', 'dropPages', 'unmount'],
    transfers: {
      putPage: (message) => [message.samples.buffer],
    },
  },
});
