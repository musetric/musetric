import { type TranscriptionSegment, type TranscriptionWord } from './types.js';

const wordEndLead = 0.15;
const wordStartLead = 0.1;
const wordStartLeadPerSecond = 0.2;
const wordStartLeadMaxSeconds = 1.0;

const earlier = (time: number, lead: number): number =>
  Math.max(0, time - lead);

const leadWord = (word: TranscriptionWord): TranscriptionWord => {
  const length = Math.min(word.end - word.start, wordStartLeadMaxSeconds);
  const start = earlier(
    word.start,
    wordStartLead + wordStartLeadPerSecond * length,
  );
  return {
    ...word,
    start,
    end: Math.max(start, earlier(word.end, wordEndLead)),
  };
};

export const leadWordTimes = (
  segments: TranscriptionSegment[],
): TranscriptionSegment[] =>
  segments.map((segment) => {
    const words = segment.words?.map(leadWord) ?? [];
    if (words.length === 0) {
      return {
        ...segment,
        start: earlier(segment.start, wordStartLead),
        end: earlier(segment.end, wordEndLead),
      };
    }
    return {
      ...segment,
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
    };
  });
