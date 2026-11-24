import { type api } from '@musetric/api';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type SettledLoopTry = {
  id: string;
  startFrame: number;
  frameCount: number;
};

export type EngineDecoderOutboundMethods = {
  boot: (message: {
    playerPort: MessagePort;
    spectrogramPort: MessagePort;
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
  sendRecordingUndo: () => void;
  sendRecordingRedo: () => void;
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
  loopTrySettled: (message: { loopTry?: SettledLoopTry }) => void;
  loopTryInserted: (message: { inserted: boolean }) => void;
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
      'recordingsChanged',
      'recordingContentChanged',
      'loopTrySettled',
      'loopTryInserted',
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
      'sendRecordingUndo',
      'sendRecordingRedo',
    ],
    transfers: {
      boot: (message) => [message.playerPort, message.spectrogramPort],
      startRecordingStream: (message) => [message.port],
    },
  },
});
