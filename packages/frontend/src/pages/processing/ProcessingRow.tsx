import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  Card,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { type api } from '@musetric/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { doneCount, runningStep, stepOrder } from './queue.js';
import { stepTitles } from './stepTitles.js';

const runningValue = (step: api.project.ProcessingStep): number | undefined => {
  const { unit, unitCount } = step;
  if (step.phase !== 'running' || unit === undefined || !unitCount) {
    return undefined;
  }
  return (unit / unitCount) * 100;
};

export type ProcessingRowProps = {
  projectItem: api.project.Item;
  draggable: boolean;
};

export const ProcessingRow: FC<ProcessingRowProps> = (props) => {
  const { projectItem, draggable } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pause = useMutation(
    endpoints.processing.pauseProject(queryClient, projectItem.id),
  );
  const running = runningStep(projectItem);
  const progress = running && runningValue(running.step);

  return (
    <Card sx={{ padding: 2, opacity: projectItem.paused ? 0.6 : 1 }}>
      <Stack direction='row' alignItems='center' gap={2}>
        {draggable && <DragIndicatorIcon sx={{ cursor: 'grab' }} />}
        <Stack flexGrow={1} gap={0.5}>
          <Typography variant='subtitle1'>{projectItem.name}</Typography>
          <Typography variant='body2' color='text.secondary'>
            {running
              ? stepTitles(t)[running.name]
              : t('pages.processing.steps', {
                  done: doneCount(projectItem),
                  total: stepOrder.length,
                })}
          </Typography>
        </Stack>
        <IconButton
          aria-label={
            projectItem.paused
              ? t('pages.processing.resumeProject')
              : t('pages.processing.pauseProject')
          }
          disabled={pause.isPending}
          onClick={() => {
            pause.mutate({ paused: !projectItem.paused });
          }}
        >
          {projectItem.paused ? <PlayArrowIcon /> : <PauseIcon />}
        </IconButton>
      </Stack>
      {progress !== undefined && (
        <LinearProgress
          variant='determinate'
          value={progress}
          sx={{ marginTop: 1 }}
        />
      )}
    </Card>
  );
};
