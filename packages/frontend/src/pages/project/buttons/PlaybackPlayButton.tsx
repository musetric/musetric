import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const PlaybackPlayButton: FC = () => {
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const isSlave = useEngineStore((state) => state.isSlave);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const disabled =
    !frameCount || realtimeFailed || playerCommandPending || isSlave;

  return (
    <IconButton
      disabled={disabled}
      onClick={() => {
        void engine.player.play();
      }}
      size='small'
      sx={{
        alignSelf: 'stretch',
        borderBottomLeftRadius: 0,
        borderTopLeftRadius: 0,
        flex: 1,
      }}
      title={t('pages.project.player.controls.play')}
    >
      <PlayArrowRoundedIcon />
    </IconButton>
  );
};
