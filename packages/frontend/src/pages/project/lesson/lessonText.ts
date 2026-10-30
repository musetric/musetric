import {
  type VocalLessonConcept,
  type VocalLessonDifference,
  type VocalLessonDirection,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';

const slightCents = 75;
const slightMs = 80;

const isSlight = (difference: VocalLessonDifference) =>
  difference.size < (difference.concept === 'pitch' ? slightCents : slightMs);

const directionTexts: Record<
  VocalLessonDirection,
  (t: TFunction, slight: boolean) => string
> = {
  lower: (t, slight) =>
    slight
      ? t('pages.project.lesson.difference.lowerSlight')
      : t('pages.project.lesson.difference.lower'),
  higher: (t, slight) =>
    slight
      ? t('pages.project.lesson.difference.higherSlight')
      : t('pages.project.lesson.difference.higher'),
  late: (t, slight) =>
    slight
      ? t('pages.project.lesson.difference.lateSlight')
      : t('pages.project.lesson.difference.late'),
  early: (t, slight) =>
    slight
      ? t('pages.project.lesson.difference.earlySlight')
      : t('pages.project.lesson.difference.early'),
};

export const lessonDifferenceText = (
  t: TFunction,
  difference: VocalLessonDifference,
): string => directionTexts[difference.direction](t, isSlight(difference));

const conceptTexts: Record<VocalLessonConcept, (t: TFunction) => string> = {
  pitch: (t) => t('pages.project.lesson.concept.pitch'),
  timing: (t) => t('pages.project.lesson.concept.timing'),
};

export const lessonConceptText = (
  t: TFunction,
  concept: VocalLessonConcept,
): string => conceptTexts[concept](t);
