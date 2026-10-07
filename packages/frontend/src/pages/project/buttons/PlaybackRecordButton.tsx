import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { Box, IconButton, Tooltip } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const PlaybackRecordButton: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const isSlave = useEngineStore((state) => state.isSlave);
  const playerCommandPending = useEngineStore(
    (state) => state.playerCommandPending,
  );
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const transposed = useEngineStore((state) => state.transposeSemitones !== 0);
  const disabled =
    !frameCount ||
    realtimeFailed ||
    transposed ||
    isSlave ||
    playerCommandPending;

  return (
    <Tooltip
      enterTouchDelay={0}
      title={
        transposed
          ? t('pages.project.player.controls.recordTransposed')
          : t('pages.project.player.controls.record')
      }
    >
      <Box component='span' flex={1} alignSelf='stretch' display='flex' ml={-1}>
        <IconButton
          color='error'
          disabled={disabled}
          onClick={() => {
            void engine.player.record(projectId);
          }}
          sx={{ borderRadius: '999px 0 0 999px', flex: 1 }}
        >
          <MicRoundedIcon />
        </IconButton>
      </Box>
    </Tooltip>
  );
};
