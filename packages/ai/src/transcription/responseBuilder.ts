import {
  type PayloadSegment,
  type TranscriptionSegment,
  type TranscriptionWord,
} from './types.js';

const buildPayloadWords = (
  words: TranscriptionWord[] | undefined,
): TranscriptionWord[] => {
  const payloadWords: TranscriptionWord[] = [];
  for (const word of words ?? []) {
    const text = word.text.trim();
    if (!text) {
      continue;
    }
    payloadWords.push({ start: word.start, end: word.end, text });
  }
  return payloadWords;
};

export const buildPayloadSegments = (
  segments: TranscriptionSegment[],
): PayloadSegment[] => {
  const payloadSegments: PayloadSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }
    const { start } = segment;
    const { end } = segment;
    let payloadWords = buildPayloadWords(segment.words);
    if (payloadWords.length === 0) {
      payloadWords = [{ start, end, text }];
    }
    payloadSegments.push({ start, end, text, words: payloadWords });
  }
  return payloadSegments;
};
