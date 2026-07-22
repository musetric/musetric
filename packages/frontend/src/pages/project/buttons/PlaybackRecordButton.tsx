import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { IconButton } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type PlaybackRecordButtonProps = {
  projectId: number;
};

export const PlaybackRecordButton: FC<PlaybackRecordButtonProps> = (props) => {
  const { projectId } = props;
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const isSlave = useEngineStore((state) => state.isSlave);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const sourceTempoBpm = useEngineStore((state) => state.sourceTempoBpm);
  const tempoBpm = useEngineStore((state) => state.tempoBpm);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const disabled =
    !frameCount ||
    realtimeFailed ||
    tempoBpm !== sourceTempoBpm ||
    transposeSemitones !== 0 ||
    isSlave ||
    playerCommandPending;

  return (
    <IconButton
      color='error'
      disabled={disabled}
      onClick={() => {
        void engine.player.record(projectId);
      }}
      size='small'
      sx={{
        alignSelf: 'stretch',
        borderBottomRightRadius: 0,
        borderTopRightRadius: 0,
        flex: 1,
      }}
      title={t('pages.project.player.controls.record')}
    >
      <MicRoundedIcon />
    </IconButton>
  );
};
