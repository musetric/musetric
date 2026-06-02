import { roundDuration } from './roundDuration.js';

type TimeRange = {
  start?: number;
  end?: number;
};

const getDuration = (range: TimeRange): number => {
  const { start, end } = range;
  if (start === undefined || end === undefined) {
    return 0;
  }
  const duration = end - start;
  return roundDuration(duration);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CpuMarker = <T extends (...args: any[]) => any>(fn: T) => T;
export type CpuMarkers<Label extends string> = Record<Label, CpuMarker>;

export type CpuTimer<Label extends string> = {
  markers: CpuMarkers<Label>;
  read: () => Record<Label, number>;
};

export const createCpuTimer = <Labels extends readonly string[]>(
  labels: readonly [...Labels],
): CpuTimer<Labels[number]> => {
  type Label = Labels[number];

  const ranges = labels.reduce(
    (acc, label) => {
      acc[label] = {};
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<Label, TimeRange>,
  );

  const getMarker =
    (label: Label): CpuMarker =>
    (fn) => {
      const wrapped = (...args: Parameters<typeof fn>) => {
        try {
          ranges[label].start = performance.now();
          const result = fn(...args);

          if (result instanceof Promise) {
            return result.finally(() => {
              ranges[label].end = performance.now();
            });
          }
          return result;
        } finally {
          ranges[label].end = performance.now();
        }
      };

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return wrapped as typeof fn;
    };

  const markers = labels.reduce(
    (acc, label) => {
      acc[label] = getMarker(label);
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as CpuMarkers<Label>,
  );

  return {
    markers,
    read: () =>
      labels.reduce(
        (acc, label) => {
          const range = ranges[label];
          acc[label] = getDuration(range);
          range.start = undefined;
          range.end = undefined;
          return acc;
        },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as Record<Label, number>,
      ),
  };
};
