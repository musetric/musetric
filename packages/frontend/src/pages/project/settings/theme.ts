import { useTheme } from '@mui/material';
import {
  defaultSpectrogramConfig,
  type SpectrogramColors,
} from '@musetric/spectrogram';
import { useLayoutEffect } from 'react';
import { engine } from '../../../engine/engine.js';

export const useThemeSpectrogramColors = () => {
  const theme = useTheme();

  useLayoutEffect(() => {
    const colors: SpectrogramColors = {
      foreground: theme.palette.default.main,
      background: theme.palette.background.default,
      primary: theme.palette.primary.dark,
      recordingForeground: defaultSpectrogramConfig.colors.recordingForeground,
      recordingMatch: theme.palette.success.main,
      recordingClose: defaultSpectrogramConfig.colors.recordingClose,
      recordingMiss: theme.palette.error.main,
      recordingTimingMiss: defaultSpectrogramConfig.colors.recordingTimingMiss,
    };
    engine.store.update((state) => {
      state.colors = colors;
    });
  }, [theme]);
};
