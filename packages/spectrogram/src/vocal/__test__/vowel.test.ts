import { describe, expect, it } from 'vitest';
import { detectVowels } from '../vowel.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

type Vowel = { first: number; second: number };

const ee: Vowel = { first: 450, second: 2000 };
const ah: Vowel = { first: 800, second: 1250 };
const oo: Vowel = { first: 350, second: 800 };

const fundamental = 196;

const bump = (frequency: number, center: number) =>
  Math.exp(-(Math.log2(frequency / center) ** 2) / (2 * 0.12 ** 2));

const voiced = (vowel: Vowel) =>
  Array.from({ length: 24 }, (_, index) => {
    const frequency = fundamental * (index + 1);
    return (
      (0.04 +
        bump(frequency, vowel.first) +
        0.6 * bump(frequency, vowel.second)) /
      Math.sqrt(index + 1)
    );
  });

const song = async (vowels: Vowel[]) =>
  analyzeSynthetic(
    synthesizeVoice(
      7,
      vowels.map((vowel, index): ToneSpec => ({
        start: 0.5 + index * 1.2,
        duration: 0.8,
        frequency: fundamental,
        harmonics: voiced(vowel),
      })),
    ),
  );

describe('vocal vowels', () => {
  it('asks for the open vowel of the singer', async () => {
    const lead = await song([ee, ee, ah, ee, ee]);
    const take = await song([ee, ee, ee, ee, ee]);
    const marks = detectVowels(lead, take);
    expect(marks).toHaveLength(1);
    expect(marks[0].advice).toBe('open');
    expect(marks[0].start).toBeGreaterThan(2.8);
  });

  it('asks for the round vowel of the singer', async () => {
    const lead = await song([ee, ee, oo, ee, ee]);
    const take = await song([ee, ee, ee, ee, ee]);
    const [mark] = detectVowels(lead, take);
    expect(mark.advice).toBe('round');
  });

  it('matches the same vowels', async () => {
    const lead = await song([ee, ee, ah, ee, ee]);
    const take = await song([ee, ee, ah, ee, ee]);
    expect(detectVowels(lead, take)).toHaveLength(0);
  });
});
