import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Button } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';

export type FlowPauseProps = {
  projectId: number;
  paused: boolean;
};

export const FlowPause: FC<FlowPauseProps> = (props) => {
  const { projectId, paused } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pause = useMutation(
    endpoints.processing.pauseProject(queryClient, projectId),
  );

  return (
    <Button
      variant='outlined'
      disabled={pause.isPending}
      startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
      onClick={() => {
        pause.mutate({ paused: !paused });
      }}
    >
      {paused
        ? t('pages.processing.resumeProject')
        : t('pages.processing.pauseProject')}
    </Button>
  );
};
