import { Slider, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const RecordingGainControl: FC = () => {
  const { t } = useTranslation();
  const recordingGain = useEngineStore((state) => state.recordingGain);

  return (
    <Stack gap={1}>
      <Typography variant='body2'>
        {t('pages.project.audioSettings.gain', {
          value: Math.round(recordingGain * 100),
        })}
      </Typography>
      <Slider
        min={0}
        max={200}
        step={5}
        value={Math.round(recordingGain * 100)}
        onChange={(_, value) => {
          if (Array.isArray(value)) {
            return;
          }
          engine.store.update((state) => {
            state.recordingGain = value / 100;
          });
        }}
      />
    </Stack>
  );
};
