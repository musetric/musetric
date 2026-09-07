import AutorenewIcon from '@mui/icons-material/Autorenew';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { Chip, type ChipProps } from '@mui/material';
import { type api } from '@musetric/api';
import { type TFunction } from 'i18next';
import { type FC, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

const getStatusTranslations = (
  t: TFunction,
): Record<api.project.ProcessingStepStatus, string> => ({
  pending: t('pages.project.progress.status.pending'),
  processing: t('pages.project.progress.status.processing'),
  failed: t('pages.project.progress.status.failed'),
  done: t('pages.project.progress.status.done'),
});

const getPhaseTranslations = (
  t: TFunction,
): Record<api.project.ProcessingPhase, string> => ({
  preparing: t('pages.project.progress.phase.preparing'),
  decoding: t('pages.project.progress.phase.decoding'),
  loading: t('pages.project.progress.phase.loading'),
  running: t('pages.project.progress.phase.running'),
  saving: t('pages.project.progress.phase.saving'),
});

const statusChipColor: Record<
  api.project.ProcessingStepStatus,
  ChipProps['color']
> = {
  pending: 'default',
  processing: 'primary',
  failed: 'error',
  done: 'success',
};

const statusIcon: Record<api.project.ProcessingStepStatus, JSX.Element> = {
  pending: <ScheduleIcon fontSize='small' />,
  processing: <AutorenewIcon fontSize='small' />,
  failed: <ErrorOutlineIcon fontSize='small' />,
  done: <CheckCircleIcon fontSize='small' />,
};

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

  const phaseLabel = getPhaseLabel(step, t);
  const label = phaseLabel ?? getStatusTranslations(t)[step.status];
  const count = getCountLabel(step);

  return (
    <Chip
      size='small'
      variant='outlined'
      color={statusChipColor[step.status]}
      icon={statusIcon[step.status]}
      label={count === undefined ? label : `${label} • ${count}`}
    />
  );
};
