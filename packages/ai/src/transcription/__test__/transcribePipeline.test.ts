import { describe, expect, it } from 'vitest';
import { sampleRate } from '../spectralChunker.js';
import {
  groupWordsIntoSegments,
  runTranscription,
} from '../transcribePipeline.js';
import { type TranscriptionWord } from '../types.js';

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

describe('runTranscription', () => {
  it('maps word timestamps from compacted time back to the original timeline', async () => {
    const audio = new Float32Array(sampleRate * 8);
    for (let i = sampleRate * 2; i < sampleRate * 6; i++) {
      audio[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sampleRate);
    }

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

    const payload = await runTranscription({ audio, transcribeBatch });
    expect(payload).toHaveLength(1);
    expect(payload[0].text).toBe('Hello world');

    expect(payload[0].words[0].start).toBeGreaterThan(1.5);
    expect(payload[0].words[0].start).toBeLessThan(3.5);
  });

  it('returns empty for fully silent audio', async () => {
    const audio = new Float32Array(sampleRate * 4);
    const payload = await runTranscription({
      audio,
      transcribeBatch: async (slices) =>
        Promise.resolve(
          slices.map(() => [{ text: 'ghost', start: 0, end: 1 }]),
        ),
    });
    expect(payload).toEqual([]);
  });
});
