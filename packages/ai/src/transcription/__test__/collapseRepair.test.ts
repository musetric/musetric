import { describe, expect, it } from 'vitest';
import { type Chunk, type Mapping } from '../audioCompaction.js';
import { repairCollapsedWindows } from '../collapseRepair.js';
import { sampleRate, type Span } from '../spectralChunker.js';
import { type TranscriptionWord } from '../types.js';

const fillBursts = (
  audio: Float32Array,
  startSec: number,
  endSec: number,
): void => {
  const periodSamples = Math.round(0.3 * sampleRate);
  const toneSamples = Math.round(0.12 * sampleRate);
  const from = Math.round(startSec * sampleRate);
  const to = Math.round(endSec * sampleRate);
  for (let i = from; i < to; i++) {
    const phase = (i - from) % periodSamples;
    audio[i] =
      phase < toneSamples
        ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
        : 0;
  }
};

describe('repairCollapsedWindows', () => {
  it('rebuilds a collapsed window and leaves a clean one untouched', async () => {
    const audio = new Float32Array(sampleRate * 40);
    fillBursts(audio, 20, 40);

    const chunks: Chunk[] = [
      { start: 0, end: 20, segments: [[0, 20]] },
      { start: 20, end: 40, segments: [[20, 40]] },
    ];
    const packed: Span[][] = [[[0, 20]], [[20, 40]]];
    const mapping: Mapping[] = [
      [0, 20, 0],
      [20, 40, 20],
    ];

    const cleanWords: TranscriptionWord[] = [];
    for (let t = 0; t < 20; t++) {
      cleanWords.push({ text: `clean${t}`, start: t, end: t + 0.8 });
    }

    const collapsedWords: TranscriptionWord[] = [
      { text: 'lonely', start: 20, end: 20.5 },
    ];
    const wordsPerChunk = [cleanWords, collapsedWords];

    const transcribeSlice = async (
      slice: Float32Array,
    ): Promise<TranscriptionWord[]> => {
      expect(slice.length).toBeGreaterThan(0);
      const words: TranscriptionWord[] = [];
      for (let i = 0; i < 10; i++) {
        words.push({
          text: `recovered${i}`,
          start: 17 + i * 0.5,
          end: 17.4 + i * 0.5,
        });
      }
      return Promise.resolve(words);
    };

    const repaired = await repairCollapsedWindows({
      compacted: audio,
      chunks,
      packed,
      wordsPerChunk,
      mapping,
      transcribeSlice,
    });

    expect(repaired[0]).toBe(cleanWords);
    expect(repaired[1].length).toBeGreaterThan(collapsedWords.length);
    expect(repaired[1]).toHaveLength(20);

    for (const word of repaired[1]) {
      expect(word.start).toBeGreaterThanOrEqual(20);
      expect(word.end).toBeLessThanOrEqual(40);
    }
  });

  it('does not rebuild when the re-decode is a low-diversity loop', async () => {
    const audio = new Float32Array(sampleRate * 40);
    fillBursts(audio, 20, 40);
    const chunks: Chunk[] = [
      { start: 0, end: 20, segments: [[0, 20]] },
      { start: 20, end: 40, segments: [[20, 40]] },
    ];
    const packed: Span[][] = [[[0, 20]], [[20, 40]]];
    const mapping: Mapping[] = [
      [0, 20, 0],
      [20, 40, 20],
    ];
    const cleanWords: TranscriptionWord[] = [];
    for (let t = 0; t < 20; t++) {
      cleanWords.push({ text: `clean${t}`, start: t, end: t + 0.8 });
    }
    const collapsedWords: TranscriptionWord[] = [
      { text: 'lonely', start: 20, end: 20.5 },
    ];

    const transcribeSlice = async (): Promise<TranscriptionWord[]> => {
      const words: TranscriptionWord[] = [];
      for (let i = 0; i < 10; i++) {
        words.push({ text: 'la', start: 17 + i * 0.5, end: 17.4 + i * 0.5 });
      }
      return Promise.resolve(words);
    };

    const repaired = await repairCollapsedWindows({
      compacted: audio,
      chunks,
      packed,
      wordsPerChunk: [cleanWords, collapsedWords],
      mapping,
      transcribeSlice,
    });
    expect(repaired[1]).toEqual(collapsedWords);
  });
});
