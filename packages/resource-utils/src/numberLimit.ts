export type NumberLimitRange = {
  minimum: number;
  maximum: number;
};

export type NumberLimit = {
  clamp: (value: number) => number;
};

export const createNumberLimit = (range: NumberLimitRange): NumberLimit => {
  const { minimum, maximum } = range;

  return {
    clamp: (value) => {
      if (value < minimum) {
        return minimum;
      }

      if (value > maximum) {
        return maximum;
      }

      return value;
    },
  };
};
