import { type VocalLessonPhrase } from '@musetric/spectrogram';
import { type LessonPlace } from './lessonStore.js';

const sameStartSeconds = 0.001;
const maxSingMarginSeconds = 0.15;

export const findLessonPhrase = (
  phrases: readonly VocalLessonPhrase[],
  place: LessonPlace,
): VocalLessonPhrase | undefined =>
  phrases.find(
    (phrase) => Math.abs(phrase.start - place.start) < sameStartSeconds,
  );

export type LessonVerdict = 'differ' | 'clean' | 'unsung';

export const lessonVerdictOf = (
  phrase: VocalLessonPhrase | undefined,
): LessonVerdict => {
  if (!phrase?.sung) {
    return 'unsung';
  }
  return phrase.difference ? 'differ' : 'clean';
};

export const toLessonPlace = (phrase: VocalLessonPhrase): LessonPlace => ({
  start: phrase.start,
  end: phrase.end,
  focusStart: phrase.difference?.focusStart ?? phrase.start,
  focusEnd: phrase.difference?.focusEnd ?? phrase.end,
});

export type LessonSpan = {
  start: number;
  end: number;
  focusStart?: number;
};

export const lessonSingRange = (
  phrases: readonly VocalLessonPhrase[],
  span: LessonSpan,
) => {
  const before = phrases.findLast((phrase) => phrase.end <= span.start);
  const after = phrases.find((phrase) => phrase.start >= span.end);
  const startMargin = before
    ? Math.min(maxSingMarginSeconds, (span.start - before.end) / 2)
    : maxSingMarginSeconds;
  const endMargin = after
    ? Math.min(maxSingMarginSeconds, (after.start - span.end) / 2)
    : maxSingMarginSeconds;
  return {
    singStart: Math.max(0, span.start - startMargin),
    singEnd: span.end + endMargin,
  };
};
