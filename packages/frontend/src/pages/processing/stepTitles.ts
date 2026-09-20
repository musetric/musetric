import { type api } from '@musetric/api';
import { type TFunction } from 'i18next';

export const stepTitles = (
  t: TFunction,
): Record<api.project.ProcessingStepName, string> => ({
  separation: t('pages.project.progress.steps.separation'),
  voices: t('pages.project.progress.steps.voices'),
  transcription: t('pages.project.progress.steps.transcription'),
  rhythm: t('pages.project.progress.steps.rhythm'),
  key: t('pages.project.progress.steps.key'),
  chords: t('pages.project.progress.steps.chords'),
});
