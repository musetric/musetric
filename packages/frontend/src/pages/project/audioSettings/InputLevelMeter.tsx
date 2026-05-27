import { LinearProgress, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useAudioSettingsStore } from './audioSettingsStore.js';

export const InputLevelMeter: FC = () => {
  const { t } = useTranslation();
  const recordingGain = useEngineStore((state) => state.recordingGain);
  const level = useAudioSettingsStore((state) => state.level);
  const gainedLevel = Math.min(1, level * recordingGain);

  return (
    <Stack gap={1}>
      <Typography variant='body2'>
        {t('pages.project.audioSettings.level')}
      </Typography>
      <LinearProgress variant='determinate' value={gainedLevel * 100} />
    </Stack>
  );
};
