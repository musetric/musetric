import { Alert } from '@mui/material';
import { type FC } from 'react';
import { useAudioSettingsStore } from './audioSettingsStore.js';

export const AudioSettingsError: FC = () => {
  const error = useAudioSettingsStore((state) => state.error);

  return error ? <Alert severity='error'>{error}</Alert> : undefined;
};
