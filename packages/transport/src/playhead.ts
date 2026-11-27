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

export const isStartHeard = (value: PlayheadValue) =>
  value.contextFrame > value.startContextFrame;

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
