import { type StemType, type WaveformColors } from '@musetric/audio/es';
import { type ViewSize } from '@musetric/utils';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type WaveformOutboundMethods = {
  boot: () => void;
  mountStem: (message: {
    projectId: number;
    stemType: StemType;
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    frameCount: number;
  }) => void;
  mountRecording: (message: {
    projectId: number;
    recordingId?: number;
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    frameCount: number;
  }) => void;
  unmountStem: (message: { stemType: StemType }) => void;
  unmountRecording: () => void;
  setColors: (message: { colors: WaveformColors }) => void;
  setSourceGainDb: (message: { gainDb: number }) => void;
  resizeStem: (message: { stemType: StemType; viewSize: ViewSize }) => void;
  resizeRecording: (message: { viewSize: ViewSize }) => void;
  refreshStem: (message: { stemType: StemType }) => void;
  refreshRecording: () => void;
  setRecording: (message: { recordingId?: number }) => void;
  applyRecordingPeakPatch: (message: {
    recordingId: number;
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
};

export type WaveformInboundMethods = {
  booted: () => void;
  setStemState: (message: {
    stemType: StemType;
    status: 'error' | 'success';
  }) => void;
  setRecordingState: (message: { status: 'error' | 'success' }) => void;
};

export const waveformChannel = createMessageChannel<
  WaveformInboundMethods,
  WaveformOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setStemState', 'setRecordingState'],
  },
  outbound: {
    keys: [
      'boot',
      'mountStem',
      'mountRecording',
      'unmountStem',
      'unmountRecording',
      'setColors',
      'setSourceGainDb',
      'resizeStem',
      'resizeRecording',
      'refreshStem',
      'refreshRecording',
      'setRecording',
      'applyRecordingPeakPatch',
    ],
    transfers: {
      mountStem: (message) => [message.canvas],
      mountRecording: (message) => [message.canvas],
    },
  },
});
