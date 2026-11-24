import { type PlayheadLoop, type PlayheadValue } from './playhead.cross.js';

const maxExtrapolationSeconds = 0.25;

export const wrapLoop = (
  frameIndex: number,
  loop: PlayheadLoop | undefined,
) => {
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

const correctionShare = 0.1;
const jumpSeconds = 0.2;

const loopLength = (loop: PlayheadLoop | undefined) =>
  loop ? loop.toFrame - loop.fromFrame : 0;

export const sameLoop = (
  left: PlayheadLoop | undefined,
  right: PlayheadLoop | undefined,
) => left?.fromFrame === right?.fromFrame && left?.toFrame === right?.toFrame;

const nearestTurn = (
  target: number,
  predicted: number,
  loop: PlayheadLoop | undefined,
) => {
  const length = loopLength(loop);
  if (length <= 0) {
    return target;
  }
  return target + Math.round((predicted - target) / length) * length;
};

type Shown = {
  frameIndex: number;
  epochMs: number;
  revision: number;
  loop?: PlayheadLoop;
};

export type PlayheadPresenter = {
  present: (value: PlayheadValue, epochMs: number) => number;
};

export const createPlayheadPresenter = (
  sampleRate: number,
): PlayheadPresenter => {
  let shown: Shown | undefined = undefined;

  const show = (value: PlayheadValue, epochMs: number, frameIndex: number) => {
    shown = {
      frameIndex,
      epochMs,
      revision: value.revision,
      loop: value.loop,
    };
    return Math.round(
      Math.min(value.endFrame, Math.max(0, wrapLoop(frameIndex, value.loop))),
    );
  };

  return {
    present: (value, epochMs) => {
      const target = extrapolatePlayhead(value, epochMs, sampleRate);
      const rolling = value.rate !== 0 && value.clockOffset !== undefined;
      if (
        !shown ||
        !rolling ||
        shown.revision !== value.revision ||
        !sameLoop(shown.loop, value.loop)
      ) {
        return show(value, epochMs, target);
      }
      const step =
        (Math.max(0, epochMs - shown.epochMs) / 1000) * sampleRate * value.rate;
      const predicted = shown.frameIndex + step;
      const error = nearestTurn(target, predicted, value.loop) - predicted;
      if (Math.abs(error) > jumpSeconds * sampleRate) {
        return show(value, epochMs, target);
      }
      const limit = correctionShare * step;
      const corrected = predicted + Math.max(-limit, Math.min(limit, error));
      return show(value, epochMs, corrected);
    },
  };
};
