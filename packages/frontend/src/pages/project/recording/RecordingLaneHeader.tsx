import { Box, Typography } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { RecordingPicker } from './RecordingPicker.js';

export const RecordingLaneHeader: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const empty = useEngineStore(
    (state) => getActiveRecording(state)?.empty === true,
  );

  return (
    <>
      <Box position='absolute' top={8} left={8} zIndex={1}>
        <RecordingPicker variant='lane' />
      </Box>
      {empty && !recording && (
        <Typography
          variant='caption'
          color='text.secondary'
          position='absolute'
          left={0}
          right={0}
          bottom={10}
          textAlign='center'
          sx={{ pointerEvents: 'none' }}
        >
          {t('pages.project.recording.emptyHint')}
        </Typography>
      )}
    </>
  );
};
