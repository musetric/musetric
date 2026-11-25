import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { HoldRing } from './HoldRing.js';
import { canStartPlayback } from './playback.js';
import { useLongPress } from './useLongPress.js';

export const PlaybackPlayButton: FC = () => {
  const { t } = useTranslation();
  const setAudioSettingsOpen = useProjectStore(
    (state) => state.setAudioSettingsOpen,
  );
  const longPress = useLongPress(() => {
    setAudioSettingsOpen(true);
  });
  const disabled = !useEngineStore(canStartPlayback);

  return (
    <IconButton
      disabled={disabled}
      aria-haspopup='dialog'
      {...longPress.handlers}
      onClick={() => {
        void engine.player.play();
      }}
      sx={{
        alignSelf: 'stretch',
        borderRadius: '0 999px 999px 0',
        flex: 1,
        mr: -1,
        p: 0,
        position: 'relative',
        touchAction: 'manipulation',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      title={t('pages.project.player.controls.play')}
    >
      <HoldRing holding={longPress.holding} />
      <PlayArrowRoundedIcon fontSize='large' />
    </IconButton>
  );
};
