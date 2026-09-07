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

const getRunningValue = (
  step: api.project.ProcessingStep,
): number | undefined => {
  const { unit, unitCount } = step;
  if (step.phase !== 'running' || unit === undefined || !unitCount) {
    return undefined;
  }
  return (unit / unitCount) * 100;
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
  const running = getRunningValue(step);

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
      {running !== undefined && (
        <LinearProgress variant='determinate' value={running} />
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
