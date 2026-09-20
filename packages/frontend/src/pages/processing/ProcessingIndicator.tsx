import PendingIcon from '@mui/icons-material/HourglassEmpty';
import PauseIcon from '@mui/icons-material/Pause';
import { Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';
import { queued, runningStep } from './queue.js';
import { stepTitles } from './stepTitles.js';

export const ProcessingIndicator: FC = () => {
  const { t } = useTranslation();
  const processing = useQuery(endpoints.processing.get());
  const projectList = useQuery(endpoints.project.list());
  const waiting = queued(projectList.data ?? []);
  const running = waiting.map(runningStep).find((step) => step !== undefined);
  const paused = processing.data?.paused ?? false;

  const label = (): string => {
    if (paused) {
      return t('pages.processing.indicator.paused');
    }
    if (running) {
      return stepTitles(t)[running.name];
    }
    return t('pages.processing.indicator.idle', { count: waiting.length });
  };

  return (
    <Button
      component={routes.processing.Link}
      variant='text'
      startIcon={paused ? <PauseIcon /> : <PendingIcon />}
    >
      {label()}
    </Button>
  );
};
