import { type TranscriptionSegment } from './types.js';

const hallucinationPatterns: RegExp[] = [
  /субтитр/i,
  /дима\s*торзок/i,
  /dimatorzok/i,
  /редактор\s+субтитров/i,
  /корректор/i,
  /продолжение\s+следует/i,
  /подписывайтесь/i,
  /спасибо\s+за\s+просмотр/i,

  /subtitles?\s+by/i,
  /thanks?\s+for\s+watching/i,
  /please\s+subscribe/i,
  /subscribe\s+to/i,

  /^(?:thank\s*you[\s.,!]*)+$/i,

  /amara\.org/i,
  /transcri(?:bed|ption)\s+by/i,
  /www\./i,
  /\.com\b/i,

  /©\s*transcript/i,
  /emily\s+beynon/i,
];

export const isHallucination = (text: string): boolean => {
  const stripped = text.trim();
  if (!stripped) {
    return false;
  }
  return hallucinationPatterns.some((pattern) => pattern.test(stripped));
};

export const filterHallucinatedSegments = (
  segments: TranscriptionSegment[],
): TranscriptionSegment[] =>
  segments.filter((segment) => !isHallucination(segment.text));
