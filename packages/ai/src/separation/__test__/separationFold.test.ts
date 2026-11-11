import { describe, expect, it } from 'vitest';
import {
  createSeparationFold,
  type FoldOptions,
  type FoldRegion,
  foldWeights,
  restoreSeparationFold,
  type SeparationFold,
} from '../separationFold.js';
import { type SeparationUnit } from '../separationPlan.js';

const hamming = (position: number, chunkSamples: number): number =>
  0.54 - 0.46 * Math.cos((2 * Math.PI * position) / chunkSamples);

const unitsAt = (starts: number[], length: number): SeparationUnit[] =>
  starts.map((start) => ({ start, length }));

const outputFor = (
  unit: number,
  chunkSamples: number,
  outputs: number,
): Float32Array =>
  Float32Array.from({ length: outputs * chunkSamples }, (_, index) => {
    const seed =
      unit * 31 +
      (index % chunkSamples) * 7 +
      Math.floor(index / chunkSamples) * 13;
    return (seed % 97) / 97 - 0.5;
  });

const referenceFold = (
  options: FoldOptions,
  outputOf: (unit: number) => Float32Array,
): Float32Array[] => {
  const { units, chunkSamples, outputs, frames } = options;
  const target = Array.from(
    { length: outputs },
    () => new Float32Array(frames),
  );
  const counter = Array.from(
    { length: outputs },
    () => new Float32Array(frames),
  );
  for (const [index, unit] of units.entries()) {
    const output = outputOf(index);
    const weights = foldWeights(unit.length, chunkSamples);
    for (let channel = 0; channel < outputs; channel += 1) {
      for (let position = 0; position < unit.length; position += 1) {
        const frame = unit.start + position;
        target[channel][frame] =
          target[channel][frame] +
          output[channel * chunkSamples + position] * weights[position];
        counter[channel][frame] = counter[channel][frame] + weights[position];
      }
    }
  }
  return target.map((values, channel) =>
    values.map(
      (value, frame) => value / Math.max(counter[channel][frame], 1e-10),
    ),
  );
};

const joined = (regions: FoldRegion[], outputs: number): Float32Array[] =>
  Array.from({ length: outputs }, (_, channel) => {
    const length = regions.reduce((sum, region) => sum + region.frames, 0);
    const values = new Float32Array(length);
    let at = 0;
    for (const region of regions) {
      values.set(region.channels[channel], at);
      at += region.frames;
    }
    return values;
  });

type FoldedTrack = {
  channels: Float32Array[];
  largestTail: number;
};

const foldAll = (
  options: FoldOptions,
  outputOf: (unit: number) => Float32Array,
  restoreEvery?: number,
): FoldedTrack => {
  let fold: SeparationFold | undefined = createSeparationFold(options);
  const regions: FoldRegion[] = [];
  let largestTail = 0;
  while (fold.nextUnit() < options.units.length) {
    regions.push(fold.add(outputOf(fold.nextUnit())));
    const tail = fold.tail();
    largestTail = Math.max(
      largestTail,
      tail.target.length + tail.counter.length,
    );
    if (restoreEvery !== undefined && fold.nextUnit() % restoreEvery === 0) {
      fold = restoreSeparationFold(options, tail);
      if (!fold) {
        throw new Error('the tail should restore');
      }
    }
  }
  return { channels: joined(regions, options.outputs), largestTail };
};

const bitsOf = (channels: Float32Array[]): number[][] =>
  channels.map((values) => Array.from(new Uint32Array(values.buffer)));

describe('separation fold', () => {
  it('divides the sum by the window counter', () => {
    const options = {
      units: unitsAt([0], 4),
      chunkSamples: 4,
      outputs: 2,
      frames: 4,
    };
    const output = Float32Array.from([1, 0.5, -0.25, 2, 1, 0.5, -0.25, 2]);
    const { channels } = foldAll(options, () => output);
    for (const channel of channels) {
      expect(channel[0]).toBeCloseTo(1, 6);
      expect(channel[1]).toBeCloseTo(0.5, 6);
      expect(channel[2]).toBeCloseTo(-0.25, 6);
      expect(channel[3]).toBeCloseTo(2, 6);
    }
  });

  it('sums overlapping windows once each', () => {
    const options = {
      units: unitsAt([0, 2], 4),
      chunkSamples: 4,
      outputs: 2,
      frames: 6,
    };
    const outputs = [
      new Float32Array(8).fill(1),
      new Float32Array(8).fill(0.5),
    ];
    const { channels } = foldAll(options, (unit) => outputs[unit]);
    const overlap = (first: number, second: number): number =>
      (hamming(first, 4) + 0.5 * hamming(second, 4)) /
      (hamming(first, 4) + hamming(second, 4));
    expect(channels[0][0]).toBeCloseTo(1, 6);
    expect(channels[0][1]).toBeCloseTo(1, 6);
    expect(channels[0][2]).toBeCloseTo(overlap(2, 0), 6);
    expect(channels[0][3]).toBeCloseTo(overlap(3, 1), 6);
    expect(channels[0][4]).toBeCloseTo(0.5, 6);
    expect(channels[0][5]).toBeCloseTo(0.5, 6);
  });

  it('treats positions outside every window as silence', () => {
    const options = {
      units: unitsAt([0], 2),
      chunkSamples: 2,
      outputs: 2,
      frames: 4,
    };
    const { channels } = foldAll(options, () =>
      Float32Array.from([3, 4, 3, 4]),
    );
    expect(Array.from(channels[0])).toEqual([3, 4, 0, 0]);
    expect(Array.from(channels[1])).toEqual([3, 4, 0, 0]);
  });

  it('keeps each output of a unit in its own channel', () => {
    const options = {
      units: unitsAt([1], 2),
      chunkSamples: 2,
      outputs: 4,
      frames: 3,
    };
    const { channels } = foldAll(options, () =>
      Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    const expected = [
      [0, 1, 2],
      [0, 3, 4],
      [0, 5, 6],
      [0, 7, 8],
    ];
    for (const [channel, values] of channels.entries()) {
      for (const [frame, value] of expected[channel].entries()) {
        expect(values[frame]).toBeCloseTo(value, 6);
      }
    }
  });

  it('weighs the whole period, also of a short window', () => {
    const weights = foldWeights(484_659, 484_659);
    expect(weights[0]).toBeCloseTo(0.08, 6);
    expect(weights[Math.floor(484_659 / 2)]).toBeCloseTo(1, 3);
    expect(foldWeights(1_000, 484_659)[1]).toBeCloseTo(hamming(1, 484_659), 6);
  });

  it('settles the same bits as a fold of the whole track', () => {
    const plans: FoldOptions[] = [
      {
        units: unitsAt([0, 3, 6, 9, 7], 5),
        chunkSamples: 5,
        outputs: 2,
        frames: 14,
      },
      { units: unitsAt([0, 0, 0], 5), chunkSamples: 5, outputs: 2, frames: 5 },
      {
        units: unitsAt([0, 2, 4, 6, 8, 10, 12], 4),
        chunkSamples: 4,
        outputs: 4,
        frames: 16,
      },
    ];
    for (const options of plans) {
      const outputOf = (unit: number): Float32Array =>
        outputFor(unit, options.chunkSamples, options.outputs);
      const whole = bitsOf(referenceFold(options, outputOf));
      expect(bitsOf(foldAll(options, outputOf).channels)).toEqual(whole);
      for (const every of [1, 2, 3]) {
        expect(bitsOf(foldAll(options, outputOf, every).channels)).toEqual(
          whole,
        );
      }
    }
  });

  it('keeps a tail of the same size whatever the track length', () => {
    const tailOf = (units: number): number => {
      const options = {
        units: unitsAt(
          Array.from({ length: units }, (_, unit) => unit * 3),
          5,
        ),
        chunkSamples: 5,
        outputs: 4,
        frames: units * 3 + 2,
      };
      return foldAll(options, (unit) => outputFor(unit, 5, 4)).largestTail;
    };
    expect(tailOf(20)).toBe(tailOf(200));
  });

  it('refuses a tail that is not of this plan', () => {
    const options = {
      units: unitsAt([0, 2], 4),
      chunkSamples: 4,
      outputs: 2,
      frames: 6,
    };
    const fold = createSeparationFold(options);
    fold.add(outputFor(0, 4, 2));
    const tail = fold.tail();
    expect(restoreSeparationFold(options, tail)).toBeDefined();
    expect(
      restoreSeparationFold(options, { ...tail, nextUnit: 2 }),
    ).toBeUndefined();
    expect(
      restoreSeparationFold(options, { ...tail, settled: 1 }),
    ).toBeUndefined();
    expect(
      restoreSeparationFold(options, {
        ...tail,
        counter: tail.counter.subarray(1),
      }),
    ).toBeUndefined();
  });
});
