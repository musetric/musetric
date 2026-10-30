import { describe, expect, it } from 'vitest';
import {
  assessVocalLesson,
  pickLessonPlaces,
  type VocalLessonPhrase,
} from '../lesson.js';
import { analyzeTones, melody, shifted } from './voiceFixtures.js';

const seconds = 8;
const phraseStarts = [0.5, 3, 5.5];
const notes = [220, 247, 262, 294];
const phrases = phraseStarts.map((start) => melody(start, notes));
const lead = phrases.flat();

const assess = async (take: Parameters<typeof analyzeTones>[1]) =>
  assessVocalLesson(
    await analyzeTones(seconds, lead),
    await analyzeTones(seconds, take),
  );

describe('assessVocalLesson', () => {
  it('finds no difference when the take sings the same notes an octave lower', async () => {
    const result = await assess(shifted(lead, { cents: -1200 }));
    expect(result).toHaveLength(phraseStarts.length);
    expect(result.every((phrase) => phrase.sung)).toBe(true);
    expect(result.map((phrase) => phrase.difference)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('marks the flat note of a phrase as lower', async () => {
    const flat = phrases[1].map((tone, index) =>
      index === 2 ? shifted([tone], { cents: -80 })[0] : tone,
    );
    const result = await assess([...phrases[0], ...flat, ...phrases[2]]);
    const [, { difference }] = result;
    expect(result[0].difference).toBeUndefined();
    expect(result[2].difference).toBeUndefined();
    expect(difference?.concept).toBe('pitch');
    expect(difference?.direction).toBe('lower');
    expect(difference?.size).toBeGreaterThan(70);
    expect(difference?.size).toBeLessThan(90);
    expect(difference?.focusStart).toBeCloseTo(flat[2].start, 1);
    expect(difference?.focusEnd).toBeCloseTo(
      flat[2].start + flat[2].duration,
      1,
    );
  });

  it('marks a late phrase when the rest of the take is on time', async () => {
    const late = shifted(phrases[2], { seconds: 0.12 });
    const result = await assess([...phrases[0], ...phrases[1], ...late]);
    expect(result[0].difference).toBeUndefined();
    expect(result[1].difference).toBeUndefined();
    expect(result[2].difference?.concept).toBe('timing');
    expect(result[2].difference?.direction).toBe('late');
    expect(result[2].difference?.size).toBeGreaterThan(100);
  });

  it('ignores vibrato around the right note', async () => {
    const vibrato = phrases[0].map((tone) => ({
      ...tone,
      vibrato: { rate: 6, extentCents: 100 },
    }));
    const result = assessVocalLesson(
      await analyzeTones(seconds, vibrato),
      await analyzeTones(seconds, phrases[0]),
    );
    expect(result[0].sung).toBe(true);
    expect(result[0].difference).toBeUndefined();
  });

  it('leaves the phrases the take does not cover unsung', async () => {
    const result = await assess(phrases[0]);
    expect(result.map((phrase) => phrase.sung)).toEqual([true, false, false]);
  });
});

const phraseWith = (start: number, severity?: number): VocalLessonPhrase => ({
  start,
  end: start + 1,
  sung: true,
  difference:
    severity === undefined
      ? undefined
      : {
          concept: 'pitch',
          direction: 'lower',
          size: 60,
          focusStart: start,
          focusEnd: start + 0.5,
          severity,
        },
});

describe('pickLessonPlaces', () => {
  it('keeps the most severe sung differences in song order', () => {
    const places = pickLessonPlaces(
      [
        phraseWith(1, 1.2),
        phraseWith(2),
        phraseWith(3, 3),
        { ...phraseWith(4, 9), sung: false },
        phraseWith(5, 2),
        phraseWith(6, 1.5),
      ],
      3,
    );
    expect(places.map((place) => place.start)).toEqual([3, 5, 6]);
  });
});
