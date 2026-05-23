import { useTheme } from '@mui/material';
import { type SpectrogramColors } from '@musetric/audio';
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
      recordingClose: theme.palette.warning.main,
      recordingMiss: theme.palette.error.main,
    };
    engine.store.update((state) => {
      state.colors = colors;
    });
  }, [theme]);
};
