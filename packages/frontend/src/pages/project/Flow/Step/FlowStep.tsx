import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import {
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { type api } from '@musetric/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../../api/index.js';
import { FlowStepDownload } from './FlowStepDownload.js';
import { FlowStepStatus } from './FlowStepStatus.js';
import { getPhaseShare } from './phaseProgress.js';

type FlowStepIconProps = {
  status: api.project.ProcessingStepStatus;
};

const FlowStepIcon: FC<FlowStepIconProps> = (props) => {
  const { status } = props;

  const renderIcon = () => {
    if (status === 'done') {
      return <CheckRoundedIcon fontSize='small' color='success' />;
    }
    if (status === 'failed') {
      return <ErrorOutlineRoundedIcon fontSize='small' color='error' />;
    }
    if (status === 'processing') {
      return <CircularProgress size={18} thickness={4} color='primary' />;
    }
    return (
      <CircleOutlinedIcon fontSize='small' sx={{ color: 'text.disabled' }} />
    );
  };

  return (
    <Stack width={20} alignItems='center' flexShrink={0}>
      {renderIcon()}
    </Stack>
  );
};

const getTitleColor = (status: api.project.ProcessingStepStatus): string => {
  if (status === 'pending') {
    return 'text.disabled';
  }
  if (status === 'done') {
    return 'text.secondary';
  }
  return 'text.primary';
};

const getPhaseFraction = (
  step: api.project.ProcessingStep,
): number | undefined => {
  const { phase, unit, unitCount, download } = step;
  const share = getPhaseShare(step);
  if (share !== undefined) {
    return share;
  }
  if (phase === 'preparing' && download?.total) {
    return download.downloaded / download.total;
  }
  if (phase === 'running' && unit !== undefined && unitCount) {
    return unit / unitCount;
  }
  return undefined;
};

export type FlowStepProps = {
  projectId: number;
  stepName: api.project.ProcessingStepName;
  title: string;
  step: api.project.ProcessingStep;
};

export const FlowStep: FC<FlowStepProps> = (props) => {
  const { projectId, stepName, title, step } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const retry = useMutation(endpoints.project.retry(queryClient, projectId));
  const active = step.status === 'processing';
  const waiting = step.waiting !== undefined;
  const fraction = getPhaseFraction(step);

  return (
    <Stack gap={1}>
      <Stack direction='row' alignItems='center' gap={3}>
        <FlowStepIcon status={step.status} />
        <Typography
          variant='subtitle1'
          flexGrow={1}
          color={getTitleColor(step.status)}
        >
          {title}
        </Typography>
        {step.status === 'failed' && (
          <Button
            size='small'
            color='error'
            loading={retry.isPending}
            onClick={() => {
              retry.mutate({ step: stepName });
            }}
          >
            {t('pages.project.progress.retry')}
          </Button>
        )}
      </Stack>
      {(active || waiting || step.error) && (
        <Stack pl={7} gap={0.5}>
          {(active || waiting) && <FlowStepStatus step={step} />}
          {active && (
            <LinearProgress
              key={[
                step.phase,
                step.pass,
                step.download?.file,
                fraction === undefined,
              ].join()}
              variant={fraction === undefined ? 'indeterminate' : 'determinate'}
              value={(fraction ?? 0) * 100}
            />
          )}
          {active && <FlowStepDownload step={step} />}
          {step.error && (
            <Typography variant='caption' color='error'>
              {step.error}
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
};
