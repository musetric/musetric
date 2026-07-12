import { describe, expect, it } from 'vitest';
import {
  buildCompaction,
  computePackedChunks,
  mapTime,
} from '../audioCompaction.js';
import {
  computeChunks,
  computeFeatures,
  sampleRate,
  type Span,
} from '../spectralChunker.js';

const makeTone = (target: Float32Array, start: number, end: number): void => {
  for (let i = start; i < end; i++) {
    target[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
};

describe('computeFeatures', () => {
  it('reports lower flatness on a tone than on silence', () => {
    const audio = new Float32Array(sampleRate * 4);
    makeTone(audio, sampleRate, sampleRate * 3);
    const { energy, flatness } = computeFeatures(audio);
    expect(flatness.length).toBeGreaterThan(0);
    expect(flatness).toHaveLength(energy.length);

    const frameSec = (frame: number) => (frame * 256) / sampleRate;
    const toneFlatness: number[] = [];
    const silenceFlatness: number[] = [];
    for (let f = 0; f < flatness.length; f++) {
      const t = frameSec(f);
      if (t > 1.2 && t < 2.8) {
        toneFlatness.push(flatness[f]);
      } else if (t < 0.8) {
        silenceFlatness.push(flatness[f]);
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(toneFlatness)).toBeLessThan(mean(silenceFlatness));
  });
});

describe('computeChunks', () => {
  it('produces voiced spans inside the audio bounds', () => {
    const audio = new Float32Array(sampleRate * 6);
    makeTone(audio, sampleRate * 2, sampleRate * 4);
    const duration = audio.length / sampleRate;
    const chunks = computeChunks(audio, 30);
    expect(chunks.length).toBeGreaterThan(0);
    for (const [start, end] of chunks) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(duration);
      expect(end).toBeGreaterThan(start);
    }

    const overlapsVoiced = chunks.some((span) => span[1] > 2 && span[0] < 4);
    expect(overlapsVoiced).toBe(true);
  });
});

describe('buildCompaction + mapTime', () => {
  it('concatenates voiced spans and maps time back to the original', () => {
    const audio = new Float32Array(sampleRate * 10);
    makeTone(audio, 0, audio.length);
    const packed: Span[][] = [
      [
        [1, 3],
        [5, 7],
      ],
    ];
    const { compacted, chunks, mapping } = buildCompaction(audio, packed);

    expect(compacted).toHaveLength(sampleRate * 6);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBeCloseTo(6, 5);

    expect(mapTime(0, mapping)).toBeCloseTo(1, 5);
    expect(mapTime(1.999, mapping)).toBeCloseTo(2.999, 3);
    expect(mapTime(4, mapping)).toBeCloseTo(5, 5);
    expect(mapTime(5.5, mapping)).toBeCloseTo(6.5, 5);
  });
});

describe('computePackedChunks', () => {
  it('groups spans within the chunk-size budget', () => {
    const audio = new Float32Array(sampleRate * 6);
    makeTone(audio, sampleRate, sampleRate * 5);
    const packed = computePackedChunks(audio, 30);
    for (const group of packed) {
      const voiced = group.reduce((sum, span) => sum + (span[1] - span[0]), 0);
      expect(voiced).toBeLessThanOrEqual(30);
    }
  });
});
