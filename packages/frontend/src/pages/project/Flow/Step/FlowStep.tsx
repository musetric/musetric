import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../../api/index.js';
import {
  getProcessingStepProgress,
  getProcessingStepTitle,
} from '../../../../common/processingStep.js';
import { FlowStepDownload } from './FlowStepDownload.js';
import { FlowStepStatus } from './FlowStepStatus.js';

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

export type FlowStepProps = {
  projectId: number;
  stepKey: api.project.ProcessingStepName;
  step: api.project.ProcessingStep;
};

export const FlowStep: FC<FlowStepProps> = (props) => {
  const { projectId, stepKey, step } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const retry = useMutation(endpoints.project.retry(queryClient, projectId));
  const active = step.status === 'processing';
  const percent = Math.round(getProcessingStepProgress(step) * 100);

  return (
    <Stack gap={1}>
      <Stack direction='row' alignItems='center' gap={3}>
        <FlowStepIcon status={step.status} />
        <Typography
          variant='subtitle1'
          flexGrow={1}
          color={getTitleColor(step.status)}
        >
          {getProcessingStepTitle(stepKey, t)}
        </Typography>
        {active && (
          <Typography variant='subtitle2' color='primary'>
            {`${percent}%`}
          </Typography>
        )}
        {step.status === 'failed' && (
          <Button
            size='small'
            color='error'
            loading={retry.isPending}
            onClick={() => {
              retry.mutate({ step: stepKey });
            }}
          >
            {t('pages.project.progress.retry')}
          </Button>
        )}
      </Stack>
      {(active || step.error) && (
        <Stack pl={7} gap={0.5}>
          {active && <FlowStepStatus step={step} />}
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
