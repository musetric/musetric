import { describe, expect, it } from 'vitest';
import {
  filterHallucinatedSegments,
  isHallucination,
} from '../hallucinationFilter.js';
import { filterSilentSegments } from '../silenceFilter.js';
import { type TranscriptionSegment } from '../types.js';

describe('isHallucination', () => {
  it('flags caption boilerplate', () => {
    expect(isHallucination('Субтитры создавал DimaTorzok')).toBe(true);
    expect(isHallucination('Thanks for watching')).toBe(true);
    expect(isHallucination('Thank you. Thank you.')).toBe(true);
    expect(isHallucination('subscribe to my channel')).toBe(true);
    expect(isHallucination('visit www.example')).toBe(true);
  });

  it('keeps real lyrics, even containing "thank you" mid-line', () => {
    expect(isHallucination('I want to thank you for the love')).toBe(false);
    expect(isHallucination('Walking down the street tonight')).toBe(false);
    expect(isHallucination('')).toBe(false);
  });

  it('drops only flagged segments', () => {
    const segments: TranscriptionSegment[] = [
      { start: 0, end: 1, text: 'Hello world' },
      { start: 1, end: 2, text: 'Субтитры' },
      { start: 2, end: 3, text: 'Goodbye now' },
    ];
    expect(filterHallucinatedSegments(segments).map((s) => s.text)).toEqual([
      'Hello world',
      'Goodbye now',
    ]);
  });
});

describe('filterSilentSegments', () => {
  it('drops segments quieter than the relative threshold', () => {
    const sampleRate = 16000;
    const audio = new Float32Array(sampleRate * 3);

    for (let i = 0; i < sampleRate; i++) {
      audio[i] = 0.5;
      audio[sampleRate * 2 + i] = 0.5;
      audio[sampleRate + i] = 0.0001;
    }
    const segments: TranscriptionSegment[] = [
      { start: 0, end: 1, text: 'loud a' },
      { start: 1, end: 2, text: 'quiet' },
      { start: 2, end: 3, text: 'loud b' },
    ];
    const kept = filterSilentSegments(segments, audio, sampleRate).map(
      (s) => s.text,
    );
    expect(kept).toEqual(['loud a', 'loud b']);
  });

  it('returns input unchanged when empty', () => {
    expect(filterSilentSegments([], new Float32Array(0))).toEqual([]);
  });
});
