import { type api } from '@musetric/api';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type TakeTarget } from '../player/takeShift.cross.js';

export type SettledLoopTry = {
  id: string;
  startFrame: number;
  frameCount: number;
};

export type EngineDecoderOutboundMethods = {
  boot: (message: {
    playerPort: MessagePort;
    spectrogramPort: MessagePort;
    playheadPort: MessagePort;
    sampleRate: number;
  }) => void;
  mount: (message: { projectId: number; sampleRate: number }) => void;
  unmount: () => void;
  startRecordingStream: (message: {
    projectId: number;
    sampleRate: number;
    frameCount: number;
    latencyFrameCount: number;
    tempo: number;
    transpose: number;
    octave: number;
    draft: boolean;
    port: MessagePort;
  }) => void;
  finishRecordingStream: (message: { sequence: number }) => void;
  settleLoopTry: (message: { keep: boolean }) => void;
  selectLoopTry: (message: { tryId?: string }) => void;
  deleteLoopTry: (message: { tryId: string }) => void;
  discardLoopTries: () => void;
  insertLoopTry: (message: {
    projectId: number;
    tryId: string;
    sampleRate: number;
    frameCount: number;
  }) => void;
  exportRecording: (message: { target: TakeTarget }) => void;
  sendRecordingUndo: () => void;
  sendRecordingRedo: () => void;
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
    recordingId: number;
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
  recordingsChanged: (message: { recordings: api.recording.Item[] }) => void;
  recordingContentChanged: (message: { recordingId: number }) => void;
  recordingExported: (message: { samples: Float32Array<ArrayBuffer> }) => void;
  recordingExportFailed: () => void;
  loopTrySettled: (message: { loopTry?: SettledLoopTry }) => void;
  loopTryInserted: (message: { inserted: boolean }) => void;
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
    transfers: {
      recordingExported: (message) => [message.samples.buffer],
    },
    keys: [
      'booted',
      'setState',
      'setRealtimeState',
      'mounted',
      'unmounted',
      'recordingStreamFinished',
      'recordingStreamFailed',
      'recordingPeaksChanged',
      'recordingsChanged',
      'recordingContentChanged',
      'recordingExported',
      'recordingExportFailed',
      'loopTrySettled',
      'loopTryInserted',
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
      'settleLoopTry',
      'selectLoopTry',
      'deleteLoopTry',
      'discardLoopTries',
      'insertLoopTry',
      'exportRecording',
      'sendRecordingUndo',
      'sendRecordingRedo',
      'sendPlayerPlay',
      'sendPlayerRecord',
      'sendPlayerStop',
      'sendPlayerFrameIndex',
      'sendPlayerSyncRequest',
    ],
    transfers: {
      boot: (message) => [
        message.playerPort,
        message.spectrogramPort,
        message.playheadPort,
      ],
      startRecordingStream: (message) => [message.port],
    },
  },
});
