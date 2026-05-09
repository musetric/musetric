import { createMessageChannel } from '@musetric/resource-utils/cross/messageChannel';
import type { ViewColors } from '../common/colors.es.js';
import type { StemType } from '../common/stemType.es.js';
import type { ViewSize } from '../common/viewSize.es.js';

export type WaveformOutboundMethods = {
  boot: () => void;
  mount: (message: {
    projectId: number;
    stemType: StemType;
    canvas: OffscreenCanvas;
    colors: ViewColors;
    viewSize: ViewSize;
  }) => void;
  unmount: (message: { stemType: StemType }) => void;
  setColors: (message: { colors: ViewColors }) => void;
  resize: (message: { stemType: StemType; viewSize: ViewSize }) => void;
};

export type WaveformInboundMethods = {
  booted: () => void;
  setState: (message: {
    stemType: StemType;
    status: 'error' | 'success';
  }) => void;
};

export const waveformChannel = createMessageChannel<
  WaveformInboundMethods,
  WaveformOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setState'],
  },
  outbound: {
    keys: ['boot', 'mount', 'unmount', 'setColors', 'resize'],
    transfers: {
      mount: (message) => [message.canvas],
    },
  },
});
