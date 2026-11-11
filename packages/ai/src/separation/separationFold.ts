import {
  reachedFrames,
  type SeparationUnit,
  settledFrames,
} from './separationPlan.js';

const counterFloor = 1e-10;

export const foldWeights = (
  length: number,
  chunkSamples: number,
): Float32Array => {
  const weights = new Float32Array(length);
  for (let position = 0; position < length; position += 1) {
    weights[position] =
      0.54 - 0.46 * Math.cos((2 * Math.PI * position) / chunkSamples);
  }
  return weights;
};

export type FoldOptions = {
  units: SeparationUnit[];
  chunkSamples: number;
  outputs: number;
  frames: number;
};

const emittedFrames = (options: FoldOptions, next: number): number =>
  next === 0 ? 0 : settledFrames(options.units, next, options.frames);

const foldCapacity = (options: FoldOptions): number => {
  const { units, frames } = options;
  let capacity = 0;
  for (const [index, unit] of units.entries()) {
    const settled = emittedFrames(options, index);
    const reached = Math.max(
      reachedFrames(units, index, frames),
      unit.start + unit.length,
    );
    capacity = Math.max(capacity, reached - settled);
  }
  return capacity;
};

export type FoldTail = {
  nextUnit: number;
  settled: number;
  reached: number;
  target: Float32Array;
  counter: Float32Array;
};

const isTailOf = (options: FoldOptions, tail: FoldTail): boolean => {
  const { units, frames, outputs } = options;
  const length = tail.reached - tail.settled;
  return (
    tail.nextUnit <= units.length &&
    tail.settled === emittedFrames(options, tail.nextUnit) &&
    tail.reached ===
      Math.max(tail.settled, reachedFrames(units, tail.nextUnit, frames)) &&
    tail.counter.length === length &&
    tail.target.length === outputs * length
  );
};

export type FoldRegion = {
  start: number;
  frames: number;
  channels: Float32Array[];
};

export type SeparationFold = {
  nextUnit: () => number;
  add: (output: Float32Array) => FoldRegion;
  tail: () => FoldTail;
};

const openFold = (options: FoldOptions, tail: FoldTail): SeparationFold => {
  const { units, chunkSamples, outputs, frames } = options;
  const capacity = foldCapacity(options);
  const target = new Float32Array(outputs * capacity);
  const counter = new Float32Array(capacity);
  const weights = new Map<number, Float32Array>();
  let next = tail.nextUnit;
  let origin = tail.settled;
  let { reached } = tail;
  const kept = reached - origin;
  counter.set(tail.counter);
  for (let channel = 0; channel < outputs; channel += 1) {
    target.set(
      tail.target.subarray(channel * kept, (channel + 1) * kept),
      channel * capacity,
    );
  }

  const weightsOf = (length: number): Float32Array => {
    const found = weights.get(length);
    if (found) {
      return found;
    }
    const created = foldWeights(length, chunkSamples);
    weights.set(length, created);
    return created;
  };

  const settle = (until: number): FoldRegion => {
    const length = until - origin;
    const channels = Array.from({ length: outputs }, (_, channel) => {
      const settledChannel = new Float32Array(length);
      const base = channel * capacity;
      for (let index = 0; index < Math.min(length, capacity); index += 1) {
        settledChannel[index] =
          target[base + index] / Math.max(counter[index], counterFloor);
      }
      return settledChannel;
    });
    const shift = Math.min(length, capacity);
    for (let channel = 0; channel < outputs; channel += 1) {
      const base = channel * capacity;
      target.copyWithin(base, base + shift, base + capacity);
      target.fill(0, base + capacity - shift, base + capacity);
    }
    counter.copyWithin(0, shift, capacity);
    counter.fill(0, capacity - shift, capacity);
    const region = { start: origin, frames: length, channels };
    origin = until;
    reached = Math.max(reached, until);
    return region;
  };

  return {
    nextUnit: () => next,
    add: (output) => {
      const unit = units[next];
      const unitWeights = weightsOf(unit.length);
      const offset = unit.start - origin;
      for (let channel = 0; channel < outputs; channel += 1) {
        const base = channel * capacity + offset;
        const source = channel * chunkSamples;
        for (let position = 0; position < unit.length; position += 1) {
          target[base + position] =
            target[base + position] +
            output[source + position] * unitWeights[position];
        }
      }
      for (let position = 0; position < unit.length; position += 1) {
        counter[offset + position] =
          counter[offset + position] + unitWeights[position];
      }
      next += 1;
      reached = Math.max(reached, Math.min(frames, unit.start + unit.length));
      return settle(settledFrames(units, next, frames));
    },
    tail: () => {
      const length = reached - origin;
      const keptTarget = new Float32Array(outputs * length);
      for (let channel = 0; channel < outputs; channel += 1) {
        keptTarget.set(
          target.subarray(channel * capacity, channel * capacity + length),
          channel * length,
        );
      }
      return {
        nextUnit: next,
        settled: origin,
        reached,
        target: keptTarget,
        counter: counter.slice(0, length),
      };
    },
  };
};

export const createSeparationFold = (options: FoldOptions): SeparationFold =>
  openFold(options, {
    nextUnit: 0,
    settled: 0,
    reached: 0,
    target: new Float32Array(0),
    counter: new Float32Array(0),
  });

export const restoreSeparationFold = (
  options: FoldOptions,
  tail: FoldTail,
): SeparationFold | undefined =>
  isTailOf(options, tail) ? openFold(options, tail) : undefined;
