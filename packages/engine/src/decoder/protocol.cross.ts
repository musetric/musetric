import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

type Playhead = Int32Array<SharedArrayBuffer>;

export type EngineDecoderOutboundMethods = {
  boot: (message: {
    playerPort: MessagePort;
    spectrogramPort: MessagePort;
    playhead: Playhead;
  }) => void;
  mount: (message: { projectId: number; sampleRate: number }) => void;
  unmount: () => void;
  startRecordingStream: (message: {
    projectId: number;
    sampleRate: number;
    frameCount: number;
    latencyFrameCount: number;
    samples: Float32Array<SharedArrayBuffer>;
    metadata: Int32Array<SharedArrayBuffer>;
    port: MessagePort;
  }) => void;
  finishRecordingStream: (message: { sequence: number }) => void;
  sendPlayerPlay: () => void;
  sendPlayerRecord: () => void;
  sendPlayerStop: () => void;
  sendPlayerFrameIndex: (message: {
    frameIndex: number;
    frozen: boolean;
    revision: number;
    source: 'playback' | 'user';
  }) => void;
  sendPlayerSyncRequest: () => void;
};

export type EngineDecoderInboundMethods = {
  booted: () => void;
  setState: (message: { status: 'error' }) => void;
  setRealtimeState: (message: { status: 'success' | 'error' }) => void;
  mounted: (message: { frameCount: number }) => void;
  unmounted: () => void;
  recordingStreamFinished: () => void;
  recordingStreamFailed: (message: { error: string }) => void;
  recordingPeaksChanged: (message: {
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
  playerPlayRequested: () => void;
  playerRecordRequested: () => void;
  playerStopRequested: () => void;
  playerFrameIndexChanged: (message: {
    frameIndex: number;
    frozen: boolean;
    revision: number;
    source: 'playback' | 'user';
  }) => void;
  playerRevisionChanged: (message: { revision: number }) => void;
  playerSyncState: (message: {
    isSlave: boolean;
    playing: boolean;
    recording: boolean;
    frozen: boolean;
    frameIndex: number;
    revision: number;
  }) => void;
};

export const engineDecoderChannel = createMessageChannel<
  EngineDecoderInboundMethods,
  EngineDecoderOutboundMethods
>({
  inbound: {
    keys: [
      'booted',
      'setState',
      'setRealtimeState',
      'mounted',
      'unmounted',
      'recordingStreamFinished',
      'recordingStreamFailed',
      'recordingPeaksChanged',
      'playerPlayRequested',
      'playerRecordRequested',
      'playerStopRequested',
      'playerFrameIndexChanged',
      'playerRevisionChanged',
      'playerSyncState',
    ],
  },
  outbound: {
    keys: [
      'boot',
      'mount',
      'unmount',
      'startRecordingStream',
      'finishRecordingStream',
      'sendPlayerPlay',
      'sendPlayerRecord',
      'sendPlayerStop',
      'sendPlayerFrameIndex',
      'sendPlayerSyncRequest',
    ],
    transfers: {
      boot: (message) => [message.playerPort, message.spectrogramPort],
      startRecordingStream: (message) => [message.port],
    },
  },
});
