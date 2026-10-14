import { describe, expect, it } from 'vitest';
import {
  dropCreditWords,
  filterHallucinatedSegments,
  filterSignOffSegments,
  isHallucination,
  isSignOff,
} from '../hallucinationFilter.js';
import { filterSilentSegments } from '../silenceFilter.js';
import { type TranscriptionSegment, type TranscriptionWord } from '../types.js';

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

describe('isSignOff', () => {
  it('flags a line that is only a sign-off, in any language', () => {
    expect(isSignOff('Vielen Dank.')).toBe(true);
    expect(isSignOff('Gracias.')).toBe(true);
    expect(isSignOff('Merci beaucoup !')).toBe(true);
    expect(isSignOff('Спасибо.')).toBe(true);
  });

  it('keeps lyrics that only contain such a word', () => {
    expect(isSignOff('Gracias, dijo la luna al mar')).toBe(false);
    expect(isSignOff('Ich sage danke und gehe heim')).toBe(false);
    expect(isSignOff('Say bye to the rain tonight')).toBe(false);
  });

  it('drops only flagged segments', () => {
    const segments: TranscriptionSegment[] = [
      { start: 0, end: 1, text: 'Hallo Welt' },
      { start: 1, end: 2, text: 'Vielen Dank.' },
    ];
    expect(filterSignOffSegments(segments).map((s) => s.text)).toEqual([
      'Hallo Welt',
    ]);
  });
});

describe('dropCreditWords', () => {
  const kept = (text: string): string =>
    dropCreditWords(
      text.split(' ').map(
        (word, index): TranscriptionWord => ({
          text: word,
          start: index,
          end: index + 1,
        }),
      ),
    )
      .map((word) => word.text)
      .join(' ');

  it('drops a caption credit and keeps the lyrics around it', () => {
    expect(kept('Sous-titrage Société Radio-Canada La pluie revient')).toBe(
      'La pluie revient',
    );
    expect(kept('Der Regen fällt Untertitelung des ZDF, 2020')).toBe(
      'Der Regen fällt',
    );
    expect(kept("Sous-titrage ST' 501.")).toBe('');
    expect(kept('Suscríbete al canal Bailamos hoy')).toBe('Bailamos hoy');
    expect(kept('La Iglesia de Jesucristo de los Últimos Días Ven aquí')).toBe(
      'Ven aquí',
    );
    expect(kept('La Iglesia Últimos Días')).toBe('');
  });

  it('keeps lyrics that share words with a credit', () => {
    expect(kept('Gracias por ver la luz del sol')).toBe(
      'Gracias por ver la luz del sol',
    );
    expect(kept('Je regarde la radio du soir')).toBe(
      'Je regarde la radio du soir',
    );
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

  it('keeps every segment of a uniformly quiet stem', () => {
    const sampleRate = 16000;
    const audio = new Float32Array(sampleRate * 2).fill(0.001);
    const segments: TranscriptionSegment[] = [
      { start: 0, end: 1, text: 'quiet a' },
      { start: 1, end: 2, text: 'quiet b' },
    ];
    const kept = filterSilentSegments(segments, audio, sampleRate).map(
      (s) => s.text,
    );
    expect(kept).toEqual(['quiet a', 'quiet b']);
  });

  it('returns input unchanged when empty', () => {
    expect(filterSilentSegments([], new Float32Array(0))).toEqual([]);
  });
});
