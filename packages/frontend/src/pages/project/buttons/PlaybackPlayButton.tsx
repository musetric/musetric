import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { canPlay } from './playback.js';

export const PlaybackPlayButton: FC = () => {
  const { t } = useTranslation();
  const disabled = !useEngineStore(canPlay);

  return (
    <IconButton
      disabled={disabled}
      onClick={() => {
        void engine.player.play();
      }}
      sx={{
        alignSelf: 'stretch',
        borderRadius: '0 999px 999px 0',
        flex: 1,
        mr: -1,
        p: 0,
      }}
      title={t('pages.project.player.controls.play')}
    >
      <PlayArrowRoundedIcon fontSize='large' />
    </IconButton>
  );
};
