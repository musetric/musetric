import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const PlaybackStopButton: FC = () => {
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const disabled = !frameCount || realtimeFailed || playerCommandPending;

  return (
    <IconButton
      color={recording ? 'error' : undefined}
      disabled={disabled}
      onClick={() => {
        void engine.player.stop();
      }}
      size='small'
      sx={{
        alignSelf: 'stretch',
        borderRadius: 999,
        flex: 1,
        mx: -0.5,
      }}
      title={t('pages.project.player.controls.stop')}
    >
      <StopRoundedIcon />
    </IconButton>
  );
};
