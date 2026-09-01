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

export type FlowStepStatusProps = {
  step: api.project.ProcessingStep;
};
export const FlowStepStatus: FC<FlowStepStatusProps> = (props) => {
  const { step } = props;
  const { t } = useTranslation();

  const statusLabel = getStatusTranslations(t)[step.status];

  return (
    <Chip
      size='small'
      variant='outlined'
      color={statusChipColor[step.status]}
      icon={statusIcon[step.status]}
      label={
        step.progress !== undefined
          ? `${statusLabel} • ${(step.progress * 100).toFixed(1)}%`
          : statusLabel
      }
    />
  );
};
