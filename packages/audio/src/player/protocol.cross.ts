import { createMessageChannel } from '@musetric/resource-utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/resource-utils/cross/messagePort';
import type { StemType } from '../common/stemType.es.js';

export const playerProcessorName = 'player-processor';

export type PlayerOutboundMethods = {
  boot: (message: { dataPort: MessagePort }) => void;
  play: () => void;
  pause: () => void;
  seek: (message: { frameIndex: number }) => void;
  setTransposeSemitones: (message: { transposeSemitones: number }) => void;
  setTempoRatio: (message: { tempoRatio: number }) => void;
  setTrackVolume: (message: { stemType: StemType; volume: number }) => void;
};

export type PlayerInboundMethods = {
  booted: () => void;
  setPlaying: (message: {
    playing: boolean;
    frameIndex: number;
    positionJump?: true;
  }) => void;
  setFrameIndex: (message: { frameIndex: number; positionJump?: true }) => void;
};

export const playerChannel = createMessageChannel<
  PlayerInboundMethods,
  PlayerOutboundMethods
>({
  inbound: {
    keys: ['booted', 'setPlaying', 'setFrameIndex'],
  },
  outbound: {
    keys: [
      'boot',
      'play',
      'seek',
      'pause',
      'setTransposeSemitones',
      'setTempoRatio',
      'setTrackVolume',
    ],
    transfers: {
      boot: (message) => [message.dataPort],
    },
  },
});

export type PlayerDataMethods = {
  mount: (message: {
    frameCount: number;
    tracks: Record<StemType, Float32Array<SharedArrayBuffer>[]>;
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
    keys: ['mount', 'unmount'],
  },
});
