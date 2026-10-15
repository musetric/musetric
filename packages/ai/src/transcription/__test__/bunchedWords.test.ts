import { describe, expect, it } from 'vitest';
import { dropBunchedWords } from '../bunchedWords.js';
import { type TranscriptionWord } from '../types.js';

const texts = (words: TranscriptionWord[]): string[] =>
  words.map((word) => word.text);

describe('dropBunchedWords', () => {
  it('drops three or more words pinned to one time point', () => {
    const words: TranscriptionWord[] = [
      { text: 'we', start: 1.0, end: 1.4 },
      { text: 'sing', start: 1.4, end: 2.0 },
      { text: 'we', start: 9.6, end: 9.6 },
      { text: 'sing', start: 9.6, end: 9.6 },
      { text: 'again', start: 9.61, end: 9.61 },
    ];
    expect(texts(dropBunchedWords(words))).toEqual(['we', 'sing']);
  });

  it('keeps a pair at one point and words that take time', () => {
    const words: TranscriptionWord[] = [
      { text: 'oh', start: 3.0, end: 3.0 },
      { text: 'my', start: 3.0, end: 3.0 },
      { text: 'heart', start: 3.0, end: 3.5 },
      { text: 'beats', start: 3.5, end: 3.9 },
    ];
    expect(texts(dropBunchedWords(words))).toEqual([
      'oh',
      'my',
      'heart',
      'beats',
    ]);
  });
});
