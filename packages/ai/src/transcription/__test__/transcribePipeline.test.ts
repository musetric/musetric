import { describe, expect, it } from 'vitest';
import { buildCompaction, buildLayout } from '../audioCompaction.js';
import { sampleRate, type Span } from '../spectralChunker.js';
import {
  decodeChunkPass,
  finalizePass,
  groupWordsIntoSegments,
  planPass,
  repairPass,
} from '../transcribePipeline.js';
import { type TranscriptionWord } from '../types.js';

const makeTone = (target: Float32Array, start: number, end: number): void => {
  for (let i = start; i < end; i++) {
    target[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sampleRate);
  }
};

describe('groupWordsIntoSegments', () => {
  it('breaks on a silence gap larger than the threshold', () => {
    const words: TranscriptionWord[] = [
      { text: 'a', start: 0, end: 0.3 },
      { text: 'b', start: 0.3, end: 0.6 },
      { text: 'c', start: 2.0, end: 2.3 },
    ];
    const segments = groupWordsIntoSegments(words, 1.0);
    expect(segments.map((s) => s.text)).toEqual(['a b', 'c']);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBeCloseTo(0.6, 5);
  });
});

describe('the unit passes', () => {
  it('plans chunks, decodes them per unit and assembles the original timeline', async () => {
    const audio = new Float32Array(sampleRate * 8);
    makeTone(audio, sampleRate * 2, sampleRate * 6);

    const transcribeBatch = async (
      slices: Float32Array[],
    ): Promise<TranscriptionWord[][]> =>
      Promise.resolve(
        slices.map((slice) => {
          expect(slice.length).toBeGreaterThan(0);
          expect(slice.length).toBeLessThan(audio.length);
          return [
            { text: 'Hello', start: 0.1, end: 0.5 },
            { text: 'world', start: 0.5, end: 0.9 },
          ];
        }),
      );

    const plan = await planPass(audio, {
      chunkSize: 30,
      seamSeconds: 2.0,
      language: 'en',
    });
    expect(plan.packed.length).toBeGreaterThan(0);
    expect(plan.language).toBe('en');
    const layout = buildLayout(plan.packed, 2.0);
    expect(layout.chunks).toHaveLength(plan.packed.length);
    const { compacted } = buildCompaction(audio, plan.packed, 2.0);

    const wordsPerChunk: TranscriptionWord[][] = [];
    for (const [index, chunk] of layout.chunks.entries()) {
      const slice = compacted.subarray(
        Math.round(chunk.start * sampleRate),
        Math.round(chunk.end * sampleRate),
      );
      const decoded = await decodeChunkPass(slice, 'en', transcribeBatch);
      expect(decoded.map((word) => word.text)).toEqual(['Hello', 'world']);
      wordsPerChunk[index] = decoded;
    }

    const replaced = await repairPass({
      compacted,
      packed: plan.packed,
      chunks: layout.chunks,
      mapping: layout.mapping,
      words: wordsPerChunk,
      language: 'en',
      transcribeBatch,
    });
    expect(replaced).toEqual([]);

    const payload = finalizePass({
      compacted,
      packed: plan.packed,
      seamSeconds: 2.0,
      words: wordsPerChunk,
      replaced,
    });
    expect(payload).toHaveLength(1);
    expect(payload[0].text).toBe('Hello world');
    expect(payload[0].words[0].start).toBeGreaterThan(1.5);
    expect(payload[0].words[0].start).toBeLessThan(3.5);
  });

  it('returns empty for fully silent audio', async () => {
    const audio = new Float32Array(sampleRate * 4);
    const plan = await planPass(audio, {
      chunkSize: 30,
      seamSeconds: 2.0,
    });
    expect(plan.packed).toEqual([]);
    const payload = finalizePass({
      compacted: new Float32Array(0),
      packed: plan.packed,
      seamSeconds: 2.0,
      words: [],
      replaced: [],
    });
    expect(payload).toEqual([]);
  });

  it('applies repair replacements over the decoded words', () => {
    const packed: Span[][] = [[[0, 4]]];
    const voiced = new Float32Array(sampleRate * 4);
    makeTone(voiced, 0, voiced.length);
    const repairedWords: TranscriptionWord[] = [
      { text: 'rescued', start: 0.2, end: 1.2 },
      { text: 'lyrics', start: 1.4, end: 2.4 },
    ];
    const payload = finalizePass({
      compacted: voiced,
      packed,
      seamSeconds: 2.0,
      words: [[{ text: 'loop', start: 0.1, end: 3.9 }]],
      replaced: [{ index: 0, words: repairedWords }],
    });
    expect(payload).toHaveLength(1);
    expect(payload[0].text).toBe('rescued lyrics');
    expect(payload[0].words.map((word) => word.text)).toEqual([
      'rescued',
      'lyrics',
    ]);
  });

  it('maps a compacted late source interval to the original timeline', () => {
    const compacted = new Float32Array(sampleRate * 4);
    makeTone(compacted, 0, compacted.length);
    const payload = finalizePass({
      compacted,
      packed: [[[20, 24]]],
      seamSeconds: 2.0,
      words: [[{ text: 'late', start: 0.5, end: 1.0 }]],
      replaced: [],
    });
    expect(payload).toMatchObject([
      { text: 'late', words: [{ start: 20.5, end: 21 }] },
    ]);
  });
});
