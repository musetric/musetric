const minimumReach = 40;
const screenMargin = 8;

const getPortion = (from: number, to: number, position: number) =>
  to === from ? 0 : Math.min(Math.max((position - from) / (to - from), 0), 1);

export type ScaledDragOptions = {
  startPosition: number;
  startValue: number;
  maxValue: number;
  min: number;
  max: number;
};

export const createScaledDrag = (options: ScaledDragOptions) => {
  const { startPosition, startValue, maxValue, min, max } = options;
  const low = Math.min(
    min,
    Math.max(screenMargin, startPosition - minimumReach),
  );
  const high = Math.max(max, startPosition + minimumReach);

  return (position: number) =>
    position < startPosition
      ? startValue * (1 - getPortion(startPosition, low, position))
      : startValue +
        (maxValue - startValue) * getPortion(startPosition, high, position);
};
