import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { PauseToggleButton } from '../../../components/PauseToggleButton.js';

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
  const label = paused
    ? t('pages.processing.resumeProject')
    : t('pages.processing.pauseProject');

  return (
    <PauseToggleButton
      paused={paused}
      disabled={pause.isPending}
      label={label}
      caption={
        paused ? t('pages.processing.resume') : t('pages.processing.pause')
      }
      icon={
        paused ? (
          <PlayArrowRoundedIcon fontSize='small' />
        ) : (
          <PauseRoundedIcon fontSize='small' />
        )
      }
      onToggle={() => {
        pause.mutate({ paused: !paused });
      }}
    />
  );
};
