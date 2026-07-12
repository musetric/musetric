import { type TranscriptionSegment, type TranscriptionWord } from './types.js';

const uppercaseSplitMinLineDuration = 1.2;

const startsWithUpper = (text: string): boolean => {
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
    }
  }
  return false;
};

const endsWithStrongPunct = (text: string): boolean =>
  text.endsWith('.') || text.endsWith('!') || text.endsWith('?');

const joinWords = (words: TranscriptionWord[]): string =>
  words
    .map((word) => word.text)
    .filter(Boolean)
    .join(' ');

const normalizeWords = (
  words: TranscriptionWord[] | undefined,
): TranscriptionWord[] => {
  const normalized: TranscriptionWord[] = [];
  for (const word of words ?? []) {
    const text = word.text.trim();
    if (!text) {
      continue;
    }
    normalized.push({ text, start: word.start, end: word.end });
  }
  return normalized;
};

const splitWordsOnCapitalization = (
  words: TranscriptionWord[],
): TranscriptionWord[][] => {
  const lines: TranscriptionWord[][] = [];
  let current: TranscriptionWord[] = [];
  let lineStart = 0;
  for (const word of words) {
    const { text } = word;
    if (!text) {
      continue;
    }
    if (current.length === 0) {
      current = [word];
      lineStart = word.start;
      continue;
    }
    const prevWord = current[current.length - 1];
    const prevText = prevWord.text;
    const lineDuration = Math.max(0, prevWord.end - lineStart);
    if (
      startsWithUpper(text) &&
      !startsWithUpper(prevText) &&
      (endsWithStrongPunct(prevText) ||
        lineDuration >= uppercaseSplitMinLineDuration)
    ) {
      lines.push(current);
      current = [word];
      lineStart = word.start;
      continue;
    }
    current.push(word);
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

const lineToSegment = (
  lineWords: TranscriptionWord[],
): TranscriptionSegment => ({
  start: lineWords[0].start,
  end: lineWords[lineWords.length - 1].end,
  text: joinWords(lineWords),
  words: lineWords,
});

const splitSegment = (
  segment: TranscriptionSegment,
): TranscriptionSegment[] => {
  const text = segment.text.trim();
  if (!text) {
    return [];
  }
  const normalizedWords = normalizeWords(segment.words);
  if (normalizedWords.length > 0) {
    const splitLines = splitWordsOnCapitalization(normalizedWords);
    if (splitLines.length > 1) {
      return splitLines.map(lineToSegment);
    }
  }
  return [
    {
      start: segment.start,
      end: segment.end,
      text,
      ...(normalizedWords.length > 0 ? { words: normalizedWords } : {}),
    },
  ];
};

export const splitSegmentsByLyrics = (
  segments: TranscriptionSegment[],
): TranscriptionSegment[] => segments.flatMap(splitSegment);
