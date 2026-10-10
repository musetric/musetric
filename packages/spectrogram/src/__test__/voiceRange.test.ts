import { describe, expect, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  type VoiceRange,
  voiceViewRanges,
  type VoiceViewRangesArg,
} from '../voiceRange.js';

const noteFrequency = (semitone: number): number =>
  440 * 2 ** ((semitone - 69) / 12);

const fallback = {
  notes: { minFrequency: 120, maxFrequency: 1100 },
  spectrum: { minFrequency: 120, maxFrequency: 4000 },
};

const bands = [
  { minFrequency: 2000, maxFrequency: 4000, levelDb: -80 },
  { minFrequency: 4000, maxFrequency: 4500, levelDb: -20 },
  { minFrequency: 4500, maxFrequency: 5000, levelDb: -50 },
  { minFrequency: 5000, maxFrequency: 5600, levelDb: -10 },
];

const createArg = (
  voiceRange: VoiceRange,
  gainDb: number,
): VoiceViewRangesArg => ({
  voiceRange,
  gainDb,
  minDecibel: defaultSpectrogramConfig.minDecibel,
  visual: defaultSpectrogramConfig.visual,
  fallback,
});

describe('voice view ranges', () => {
  it('keeps the fixed ranges when the lead has no voice', () => {
    expect(voiceViewRanges(createArg({ bands }, 0))).toEqual(fallback);
  });

  it('frames the notes view on whole rows two semitones beyond the voice', () => {
    const pitch = { minFrequency: noteFrequency(45), maxFrequency: 440 };
    const { notes } = voiceViewRanges(createArg({ pitch, bands }, 0));
    expect(notes.minFrequency).toBeCloseTo(noteFrequency(42.5), 6);
    expect(notes.maxFrequency).toBeCloseTo(noteFrequency(71.5), 6);
  });

  it('widens a narrow voice to an octave and a half of rows', () => {
    const pitch = { minFrequency: noteFrequency(60.3), maxFrequency: 270 };
    const { notes } = voiceViewRanges(createArg({ pitch, bands }, 0));
    expect(notes.minFrequency).toBeCloseTo(noteFrequency(51.5), 6);
    expect(notes.maxFrequency).toBeCloseTo(noteFrequency(70.5), 6);
  });

  it('opens the spectrum below the lowest note and up to the first dark band', () => {
    const pitch = { minFrequency: noteFrequency(45), maxFrequency: 440 };
    const { spectrum } = voiceViewRanges(createArg({ pitch, bands }, 0));
    expect(spectrum.minFrequency).toBeCloseTo(noteFrequency(42), 6);
    expect(spectrum.maxFrequency).toBe(4500);
  });

  it('reaches the bright band above once the display gain lights the gap', () => {
    const pitch = { minFrequency: noteFrequency(45), maxFrequency: 440 };
    const { spectrum } = voiceViewRanges(createArg({ pitch, bands }, 30));
    expect(spectrum.maxFrequency).toBe(5600);
  });

  it('keeps the fixed top when the band above it is dark', () => {
    const pitch = { minFrequency: noteFrequency(45), maxFrequency: 440 };
    const { spectrum } = voiceViewRanges(createArg({ pitch, bands }, -60));
    expect(spectrum.maxFrequency).toBe(fallback.spectrum.maxFrequency);
  });
});
