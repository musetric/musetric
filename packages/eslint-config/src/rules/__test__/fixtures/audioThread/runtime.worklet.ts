import { half, pairOf } from './pair.cross.js';

export type RuntimeOptions = {
  read: () => number[];
};

export type Runtime = {
  process: () => void;
};

const createGain = () => {
  let level = 0;
  return {
    apply: (value: number) => {
      level = value;
      return [level];
    },
  };
};

const sum = (...values: number[]) => values.length;

const quiet = () => 0;

const unreached = () => ({ setup: true });

export const createRuntime = (options: RuntimeOptions): Runtime => {
  const settings = { gain: 1, unreached };
  const gain = createGain();
  const queue: (() => void)[] = [];
  const lookup = { map: (value: number) => value };
  const eventOnly = () => ({ event: true });
  const shared = () => new Float32Array(4);
  queue.push(() => {
    settings.gain = Float64Array.of(1).length;
  });

  return {
    process: () => {
      const values = options.read();
      gain.apply(values.length);
      for (let index = 0; index < queue.length; index += 1) {
        queue[index]();
      }
      for (const value of values) {
        lookup.map(value);
      }
      const [first] = values;
      sum(Math.max(...values), first);
      const later = () => first;
      later();
      values.slice(1);
      pairOf(half(first));
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- once per event
      eventOnly();
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- once per event
      shared();
      shared();
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- nothing behind allocates
      quiet();
    },
  };
};
