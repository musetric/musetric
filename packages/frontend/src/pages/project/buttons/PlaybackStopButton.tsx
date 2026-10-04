import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const PlaybackStopButton: FC = () => {
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const disabled = !frameCount || realtimeFailed || playerCommandPending;

  return (
    <IconButton
      color='inherit'
      disabled={disabled}
      onClick={() => {
        void engine.player.stop();
      }}
      sx={{
        alignSelf: 'stretch',
        borderRadius: 999,
        flex: 1,
        mx: -1,
      }}
      title={t('pages.project.player.controls.stop')}
    >
      <StopRoundedIcon fontSize='large' />
    </IconButton>
  );
};
