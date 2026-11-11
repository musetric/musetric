import { describe, expect, it } from 'vitest';
import {
  readSeparationState,
  type SeparationLayout,
  type SeparationState,
  writeSeparationState,
} from '../separationState.js';

const layout: SeparationLayout = {
  frames: 1_000,
  chunkSamples: 300,
  step: 200,
  unitCount: 5,
  outputs: 4,
};

const state: SeparationState = {
  tail: {
    nextUnit: 2,
    settled: 400,
    reached: 403,
    target: Float32Array.from({ length: 12 }, (_, index) => index / 8),
    counter: Float32Array.from([0.25, 0.5, 0.75]),
  },
  mixtureScale: 0.9 / 1.3,
  peaks: { vocals: 0.5, instrumental: 1.25, lead: 0.1, backing: 0 },
};

describe('separation state', () => {
  it('reads back what it wrote', () => {
    const read = readSeparationState(
      layout,
      writeSeparationState(layout, state),
    );
    expect(read?.tail.nextUnit).toBe(2);
    expect(read?.tail.settled).toBe(400);
    expect(read?.tail.reached).toBe(403);
    expect(Array.from(read?.tail.target ?? [])).toEqual(
      Array.from(state.tail.target),
    );
    expect(Array.from(read?.tail.counter ?? [])).toEqual(
      Array.from(state.tail.counter),
    );
    expect(read?.mixtureScale).toBe(state.mixtureScale);
    expect(read?.peaks).toEqual(state.peaks);
  });

  it('refuses a state of another track, plan or size', () => {
    const bytes = writeSeparationState(layout, state);
    expect(
      readSeparationState({ ...layout, frames: 1_001 }, bytes),
    ).toBeUndefined();
    expect(
      readSeparationState({ ...layout, chunkSamples: 301 }, bytes),
    ).toBeUndefined();
    expect(
      readSeparationState({ ...layout, step: 201 }, bytes),
    ).toBeUndefined();
    expect(
      readSeparationState({ ...layout, unitCount: 6 }, bytes),
    ).toBeUndefined();
    expect(
      readSeparationState(layout, bytes.subarray(0, bytes.length - 4)),
    ).toBeUndefined();
    expect(readSeparationState(layout, bytes.subarray(0, 8))).toBeUndefined();
  });

  it('refuses a state of another version', () => {
    const bytes = writeSeparationState(layout, state);
    new DataView(bytes.buffer).setUint32(0, 2, true);
    expect(readSeparationState(layout, bytes)).toBeUndefined();
  });
});
