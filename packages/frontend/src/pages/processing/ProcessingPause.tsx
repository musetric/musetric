import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { PauseToggleButton } from '../../components/PauseToggleButton.js';

export const ProcessingPause: FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const processing = useQuery(endpoints.processing.get());
  const pause = useMutation(endpoints.processing.pause(queryClient));
  const paused = processing.data?.paused ?? false;
  const label = paused
    ? t('pages.processing.resumeAll')
    : t('pages.processing.pauseAll');

  return (
    <PauseToggleButton
      paused={paused}
      disabled={processing.isPending || pause.isPending}
      label={label}
      caption={
        paused
          ? t('pages.processing.resumeQueue')
          : t('pages.processing.pauseQueue')
      }
      icon={
        paused ? (
          <PlayCircleOutlineRoundedIcon fontSize='small' />
        ) : (
          <PauseCircleOutlineRoundedIcon fontSize='small' />
        )
      }
      onToggle={() => {
        pause.mutate({ paused: !paused });
      }}
    />
  );
};
