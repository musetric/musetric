import { type StemType, type WaveformColors } from '@musetric/audio/es';
import { type ViewSize } from '@musetric/utils';
import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type WaveformOutboundMethods = {
  boot: () => void;
  mountDelivery: (message: {
    projectId: number;
    stemType: StemType;
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    frameCount: number;
  }) => void;
  mountRecording: (message: {
    projectId: number;
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    frameCount: number;
  }) => void;
  unmountDelivery: (message: { stemType: StemType }) => void;
  unmountRecording: () => void;
  setColors: (message: { colors: WaveformColors }) => void;
  setSourceGainDb: (message: { gainDb: number }) => void;
  resizeDelivery: (message: { stemType: StemType; viewSize: ViewSize }) => void;
  resizeRecording: (message: { viewSize: ViewSize }) => void;
  refreshDelivery: (message: { stemType: StemType }) => void;
  refreshRecording: () => void;
  applyRecordingPeakPatch: (message: {
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
};

export type WaveformInboundMethods = {
  booted: () => void;
  setDeliveryState: (message: {
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
    keys: ['booted', 'setDeliveryState', 'setRecordingState'],
  },
  outbound: {
    keys: [
      'boot',
      'mountDelivery',
      'mountRecording',
      'unmountDelivery',
      'unmountRecording',
      'setColors',
      'setSourceGainDb',
      'resizeDelivery',
      'resizeRecording',
      'refreshDelivery',
      'refreshRecording',
      'applyRecordingPeakPatch',
    ],
    transfers: {
      mountDelivery: (message) => [message.canvas],
      mountRecording: (message) => [message.canvas],
    },
  },
});
