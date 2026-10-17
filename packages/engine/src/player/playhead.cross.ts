import { createMessageChannel } from '@musetric/utils/cross/messageChannel';
import { type EmptyPortMethods } from '@musetric/utils/cross/messagePort';

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

const maxExtrapolationSeconds = 0.25;

const wrapLoop = (frameIndex: number, loop: PlayheadLoop | undefined) => {
  if (!loop || frameIndex < loop.toFrame) {
    return frameIndex;
  }
  const length = loop.toFrame - loop.fromFrame;
  return loop.fromFrame + ((frameIndex - loop.fromFrame) % length);
};

export const extrapolatePlayhead = (
  value: PlayheadValue,
  epochMs: number,
  sampleRate: number,
): number => {
  if (value.rate === 0 || value.clockOffset === undefined) {
    return value.frameIndex;
  }
  const heardContextFrame = (epochMs / 1000 + value.clockOffset) * sampleRate;
  const limit = maxExtrapolationSeconds * sampleRate;
  const elapsed = Math.max(
    -limit,
    Math.min(
      limit,
      Math.max(heardContextFrame, value.startContextFrame) - value.contextFrame,
    ),
  );
  const frameIndex = wrapLoop(
    value.frameIndex + elapsed * value.rate,
    value.loop,
  );
  return Math.round(Math.min(value.endFrame, Math.max(0, frameIndex)));
};

export const readEpochMs = (): number =>
  performance.timeOrigin + performance.now();

export type Playhead = {
  read: () => PlayheadValue;
  readFrameIndex: () => number;
  writeFrameIndex: (frameIndex: number) => void;
};

export const createPlayhead = (
  port: MessagePort,
  sampleRate: number,
): Playhead => {
  let value: PlayheadValue = createHeldPlayheadValue(0, 0);
  playheadChannel.inbound(port).bindHandlers({
    publish: (message) => {
      value = message;
    },
  });

  return {
    read: () => value,
    readFrameIndex: () => extrapolatePlayhead(value, readEpochMs(), sampleRate),
    writeFrameIndex: (frameIndex) => {
      value = createHeldPlayheadValue(frameIndex, value.revision);
    },
  };
};
