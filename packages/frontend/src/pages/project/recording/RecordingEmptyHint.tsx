import { Stack, Typography } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const RecordingEmptyHint: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const empty = useEngineStore(
    (state) => getActiveRecording(state)?.empty === true,
  );

  if (!empty || recording) {
    return undefined;
  }

  return (
    <Stack
      sx={{
        position: 'absolute',
        inset: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Typography
        variant='caption'
        noWrap
        sx={{
          maxWidth: '100%',
          px: 1,
          color: 'text.secondary',
          bgcolor: 'background.default',
        }}
      >
        {t('pages.project.recording.emptyHint')}
      </Typography>
    </Stack>
  );
};
