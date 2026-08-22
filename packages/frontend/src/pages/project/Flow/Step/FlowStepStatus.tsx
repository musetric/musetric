import { Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const getPhaseTranslations = (
  t: TFunction,
): Record<api.project.ProcessingPhase, string> => ({
  preparing: t('pages.project.progress.phase.preparing'),
  decoding: t('pages.project.progress.phase.decoding'),
  loading: t('pages.project.progress.phase.loading'),
  running: t('pages.project.progress.phase.running'),
  saving: t('pages.project.progress.phase.saving'),
});

const getPhaseLabel = (
  step: api.project.ProcessingStep,
  t: TFunction,
): string | undefined => {
  const { phase } = step;
  if (phase === undefined) {
    return undefined;
  }
  if (phase === 'running' && step.pass === 'repair') {
    return t('pages.project.progress.phase.repairing');
  }
  return getPhaseTranslations(t)[phase];
};

const getCountLabel = (
  step: api.project.ProcessingStep,
): string | undefined => {
  const { decoded, total, unit, unitCount } = step;
  if (step.phase === 'decoding' && decoded !== undefined && total) {
    return `${((decoded / total) * 100).toFixed(0)}%`;
  }
  if (step.phase === 'running' && unit !== undefined && unitCount) {
    return `${unit.toFixed(0)} / ${unitCount.toFixed(0)}`;
  }
  return undefined;
};

export type FlowStepStatusProps = {
  step: api.project.ProcessingStep;
};
export const FlowStepStatus: FC<FlowStepStatusProps> = (props) => {
  const { step } = props;
  const { t } = useTranslation();

  const label = getPhaseLabel(step, t);
  if (label === undefined) {
    return;
  }
  const count = getCountLabel(step);

  return (
    <Typography variant='caption' color='text.secondary'>
      {count === undefined ? label : `${label} · ${count}`}
    </Typography>
  );
};
