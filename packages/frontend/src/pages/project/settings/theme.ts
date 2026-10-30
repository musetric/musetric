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
      recordingMatch: theme.palette.success.main,
      recordingClose: defaultSpectrogramConfig.colors.recordingClose,
      recordingMiss: theme.palette.error.main,
      recordingTimingMiss: defaultSpectrogramConfig.colors.recordingTimingMiss,
      harmonic: theme.palette.primary.main,
      harmonicQuieter: theme.palette.info.main,
      harmonicLouder: theme.palette.warning.main,
      stencil: defaultSpectrogramConfig.colors.stencil,
    };
    engine.store.update((state) => {
      state.colors = colors;
    });
  }, [theme]);
};
