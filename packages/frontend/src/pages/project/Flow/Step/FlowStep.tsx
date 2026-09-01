import {
  Alert,
  alpha,
  Button,
  Card,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { type Theme, useTheme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../../api/index.js';
import { FlowStepDownload } from './FlowStepDownload.js';
import { FlowStepStatus } from './FlowStepStatus.js';

const getStatusColor = (
  status: api.project.ProcessingStepStatus,
  theme: Theme,
): string => {
  if (status === 'processing') {
    return theme.palette.primary.main;
  }
  if (status === 'done') {
    return theme.palette.success.main;
  }
  if (status === 'failed') {
    return theme.palette.error.main;
  }
  return theme.palette.grey[500];
};

export type FlowStepProps = {
  projectId: number;
  stepName: api.project.ProcessingStepName;
  title: string;
  step: api.project.ProcessingStep;
};

export const FlowStep: FC<FlowStepProps> = (props) => {
  const { projectId, stepName, title, step } = props;
  const theme = useTheme();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const retry = useMutation(endpoints.project.retry(queryClient, projectId));
  const accent = getStatusColor(step.status, theme);

  return (
    <Card
      component={Stack}
      gap={2}
      sx={{
        padding: 2,
        border: `1px solid ${alpha(accent, 0.4)}`,
        backgroundColor: `${alpha(accent, 0.1)}`,
      }}
    >
      <Stack direction='row' alignItems='center' gap={2}>
        <Typography variant='subtitle1' fontWeight='bold'>
          {title}
        </Typography>
        <FlowStepStatus step={step} />
      </Stack>
      {step.progress !== undefined && (
        <LinearProgress variant='determinate' value={step.progress * 100} />
      )}
      {step.message !== undefined && (
        <Typography variant='body2' color='text.secondary'>
          {step.message}
        </Typography>
      )}
      {step.error && (
        <Alert
          severity='error'
          action={
            <Button
              color='inherit'
              size='small'
              loading={retry.isPending}
              onClick={() => {
                retry.mutate({ step: stepName });
              }}
            >
              {t('pages.project.progress.retry')}
            </Button>
          }
        >
          {step.error}
        </Alert>
      )}
      <FlowStepDownload step={step} />
    </Card>
  );
};
