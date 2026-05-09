import { useTheme } from '@mui/material';
import { type ViewColors } from '@musetric/audio';
import { useLayoutEffect } from 'react';
import { engine } from '../../../engine/engine.js';

export const useThemeViewColors = () => {
  const theme = useTheme();

  useLayoutEffect(() => {
    const colors: ViewColors = {
      foreground: theme.palette.default.main,
      background: theme.palette.background.default,
    };
    engine.store.update((state) => {
      state.colors = colors;
    });
  }, [theme]);
};
