import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { canStop } from './playback.js';

export const PlaybackStopButton: FC = () => {
  const { t } = useTranslation();
  const disabled = !useEngineStore(canStop);

  return (
    <IconButton
      color='inherit'
      disabled={disabled}
      onClick={() => {
        void engine.player.stop();
      }}
      sx={{
        alignSelf: 'stretch',
        borderRadius: '0 999px 999px 0',
        flex: 1,
        mr: -1,
        p: 0,
      }}
      title={t('pages.project.player.controls.stop')}
    >
      <StopRoundedIcon fontSize='large' />
    </IconButton>
  );
};
