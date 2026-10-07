import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import { Box, IconButton, Stack, Tooltip } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const RecordingHistoryButtons: FC = () => {
  const { t } = useTranslation();
  const history = useEngineStore((state) => state.recordingHistory);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const locked = recording || realtimeFailed;
  const undoLabel = t('pages.project.player.controls.undoTake');
  const redoLabel = t('pages.project.player.controls.redoTake');

  return (
    <Stack direction='row'>
      <Tooltip title={undoLabel}>
        <Box component='span'>
          <IconButton
            aria-label={undoLabel}
            disabled={locked || !history.canUndo}
            onClick={() => {
              engine.decoder.sendRecordingUndo();
            }}
          >
            <UndoRoundedIcon />
          </IconButton>
        </Box>
      </Tooltip>
      <Tooltip title={redoLabel}>
        <Box component='span'>
          <IconButton
            aria-label={redoLabel}
            disabled={locked || !history.canRedo}
            onClick={() => {
              engine.decoder.sendRecordingRedo();
            }}
          >
            <RedoRoundedIcon />
          </IconButton>
        </Box>
      </Tooltip>
    </Stack>
  );
};
