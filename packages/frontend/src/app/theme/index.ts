import { createTheme } from '@mui/material';
import { noNumberInputSpin } from './noNumberInputSpin.js';
import { defaultPalette } from './palettes/default.js';
import { neutralButton, neutralPalette } from './palettes/neutral.js';
import { themeScrollbar } from './scrollbar.js';
import { themeTypography } from './typography.js';

export const appTheme = createTheme({
  spacing: 4,
  palette: {
    mode: 'dark',
    neutral: neutralPalette,
    default: defaultPalette,
  },
  typography: themeTypography,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ...themeScrollbar,
        body: {
          fontFamily: themeTypography.fontFamily,
        },
        ...noNumberInputSpin,
      },
    },
    MuiButton: {
      variants: [...neutralButton],
      defaultProps: {
        color: 'default',
      },
      styleOverrides: {
        root: (state) => {
          const { theme } = state;
          return {
            ...theme.typography.body1,
            textTransform: 'none',
          };
        },
        startIcon: (state) => {
          const { theme } = state;
          return {
            marginRight: theme.spacing(1),
          };
        },
        endIcon: (state) => {
          const { theme } = state;
          return {
            marginLeft: theme.spacing(1),
          };
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        color: 'default',
      },
    },
    MuiSlider: {
      defaultProps: {
        color: 'default',
      },
      styleOverrides: {
        root: (state) => {
          const { theme } = state;

          return {
            boxSizing: 'border-box',
            paddingLeft: theme.spacing(1.5),
            paddingRight: theme.spacing(1.5),
          };
        },
        thumb: {
          '&::before, &::after': {
            height: 20,
            width: 20,
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        autoComplete: 'off',
      },
    },
    MuiInputBase: {
      defaultProps: {
        inputProps: { autoComplete: 'off' },
      },
    },
    MuiDialog: {
      defaultProps: {
        scroll: 'body',
      },
    },
  },
});
