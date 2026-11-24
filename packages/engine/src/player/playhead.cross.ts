import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';
import {
  createPlayheadPresenter,
  extrapolatePlayhead,
} from './playheadPresenter.cross.js';

export type PlayheadLoop = {
  fromFrame: number;
  toFrame: number;
};

export type PlayheadValue = {
  frameIndex: number;
  revision: number;
  contextFrame: number;
  startContextFrame: number;
  rate: number;
  clockOffset?: number;
  endFrame: number;
  loop?: PlayheadLoop;
};

export type PlayheadMethods = {
  publish: (message: PlayheadValue) => void;
};

export const playheadChannel = createMessageChannel<
  EmptyPortMethods,
  PlayheadMethods
>({
  inbound: {
    keys: [],
  },
  outbound: {
    keys: ['publish'],
  },
});

export const createHeldPlayheadValue = (
  frameIndex: number,
  revision: number,
): PlayheadValue => ({
  frameIndex,
  revision,
  contextFrame: 0,
  startContextFrame: 0,
  rate: 0,
  endFrame: Number.POSITIVE_INFINITY,
});

export const readEpochMs = (): number =>
  performance.timeOrigin + performance.now();

export type Playhead = {
  read: () => PlayheadValue;
  readFrameIndex: () => number;
  readFrameIndexAt: (epochMs: number) => number;
  writeFrameIndex: (frameIndex: number) => void;
};

export const createPlayhead = (
  port: MessagePort,
  sampleRate: number,
): Playhead => {
  let value: PlayheadValue = createHeldPlayheadValue(0, 0);
  const presenter = createPlayheadPresenter(sampleRate);
  playheadChannel.inbound(port).bindHandlers({
    publish: (message) => {
      value = message;
    },
  });

  return {
    read: () => value,
    readFrameIndex: () => presenter.present(value, readEpochMs()),
    readFrameIndexAt: (epochMs) =>
      extrapolatePlayhead(value, epochMs, sampleRate),
    writeFrameIndex: (frameIndex) => {
      value = createHeldPlayheadValue(frameIndex, value.revision);
    },
  };
};
