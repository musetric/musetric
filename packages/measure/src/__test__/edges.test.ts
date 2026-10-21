import { describe, expect, it } from 'vitest';
import { findDrawnEdges } from './analysis/edges.js';

const sampleRate = 48000;
const columnStep = 480;

const createColumns = (values: number[]) => ({
  baseColumn: 1000,
  columnStep,
  values: Float32Array.from(values),
});

describe('findDrawnEdges', () => {
  it('finds the newest pitch and the newest loud column before the playhead', () => {
    const count = 400;
    const pitch = Array.from({ length: count }, (_, index) =>
      index < 300 ? 220 : 0,
    );
    const energy = Array.from({ length: count }, (_, index) =>
      index < 320 ? 1 : 0.1,
    );
    const playheadFrame = (1000 + 350) * columnStep;
    const edges = findDrawnEdges(
      createColumns(pitch),
      createColumns(energy),
      playheadFrame,
      sampleRate,
    );
    expect(edges.pitchEdge).toBe((1000 + 299) * columnStep);
    expect(edges.energyEdge).toBe((1000 + 319) * columnStep);
    expect(edges.level).toBe(1);
  });

  it('reports no edge when nothing is drawn', () => {
    const edges = findDrawnEdges(
      createColumns([0, 0, 0]),
      undefined,
      1000 * columnStep,
      sampleRate,
    );
    expect(edges).toEqual({ pitchEdge: -1, energyEdge: -1, level: 0 });
  });
});
