import { type api } from '@musetric/api';
import { type TFunction } from 'i18next';

export const processingStepOrder: api.project.ProcessingStepName[] = [
  'separation',
  'voices',
  'transcription',
  'rhythm',
  'key',
  'chords',
];

const processingStepTitles: Record<
  api.project.ProcessingStepName,
  (t: TFunction) => string
> = {
  separation: (t) => t('pages.project.progress.steps.separation'),
  voices: (t) => t('pages.project.progress.steps.voices'),
  transcription: (t) => t('pages.project.progress.steps.transcription'),
  rhythm: (t) => t('pages.project.progress.steps.rhythm'),
  key: (t) => t('pages.project.progress.steps.key'),
  chords: (t) => t('pages.project.progress.steps.chords'),
};

export const getProcessingStepTitle = (
  stepKey: api.project.ProcessingStepName,
  t: TFunction,
): string => processingStepTitles[stepKey](t);

const processingStepShares: Record<api.project.ProcessingStepName, number> = {
  separation: 8,
  voices: 2,
  transcription: 6,
  rhythm: 1,
  key: 1,
  chords: 2,
};

const phaseSpans: Record<
  api.project.ProcessingPhase,
  { start: number; end: number }
> = {
  preparing: { start: 0, end: 0.05 },
  decoding: { start: 0.05, end: 0.2 },
  loading: { start: 0.2, end: 0.3 },
  running: { start: 0.3, end: 0.95 },
  saving: { start: 0.95, end: 1 },
};

const getPhaseFraction = (step: api.project.ProcessingStep): number => {
  const { phase, decoded, total, unit, unitCount, download } = step;
  if (phase === 'decoding' && decoded !== undefined && total) {
    return decoded / total;
  }
  if (phase === 'loading' && download?.total) {
    return download.downloaded / download.total;
  }
  if (phase === 'running' && unit !== undefined && unitCount) {
    return unit / unitCount;
  }
  return 0;
};

export const getProcessingStepProgress = (
  step: api.project.ProcessingStep,
): number => {
  if (step.status === 'done') {
    return 1;
  }
  if (step.status !== 'processing' || step.phase === undefined) {
    return 0;
  }
  const span = phaseSpans[step.phase];
  return span.start + (span.end - span.start) * getPhaseFraction(step);
};

export const getProcessingProgress = (
  processing: api.project.Processing,
): number => {
  const weighted = processingStepOrder.reduce(
    (sum, stepKey) =>
      sum +
      processingStepShares[stepKey] *
        getProcessingStepProgress(processing.steps[stepKey]),
    0,
  );
  const shares = processingStepOrder.reduce(
    (sum, stepKey) => sum + processingStepShares[stepKey],
    0,
  );
  return weighted / shares;
};

export const getActiveProcessingStepKey = (
  processing: api.project.Processing,
): api.project.ProcessingStepName | undefined =>
  processingStepOrder.find(
    (stepKey) => processing.steps[stepKey].status === 'failed',
  ) ??
  processingStepOrder.find(
    (stepKey) => processing.steps[stepKey].status === 'processing',
  ) ??
  processingStepOrder.find(
    (stepKey) => processing.steps[stepKey].status === 'pending',
  );
