import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Button } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';

export const ProcessingPause: FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const processing = useQuery(endpoints.processing.get());
  const pause = useMutation(endpoints.processing.pause(queryClient));
  const paused = processing.data?.paused ?? false;

  return (
    <Button
      variant='contained'
      disabled={processing.isPending || pause.isPending}
      startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
      onClick={() => {
        pause.mutate({ paused: !paused });
      }}
    >
      {paused
        ? t('pages.processing.resumeAll')
        : t('pages.processing.pauseAll')}
    </Button>
  );
};
