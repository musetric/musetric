import { createTheme } from '@mui/material';
import { accent, outline, surface, white } from './colors.js';
import { noNumberInputSpin } from './noNumberInputSpin.js';
import { defaultPalette } from './palettes/default.js';
import { neutralButton, neutralPalette } from './palettes/neutral.js';
import { themeScrollbar } from './scrollbar.js';
import { themeTypography } from './typography.js';

export const appTheme = createTheme({
  spacing: 4,
  shape: {
    borderRadius: 8,
  },
  palette: {
    mode: 'dark',
    neutral: neutralPalette,
    default: defaultPalette,
    primary: {
      light: accent[300],
      main: accent[500],
      dark: accent[700],
    },
    secondary: {
      main: '#9AA0A6',
    },
    background: {
      default: surface.background,
      paper: surface.raised,
    },
    divider: outline.subtle,
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
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        scroll: 'body',
      },
      styleOverrides: {
        paper: {
          backgroundColor: surface.overlay,
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          backgroundColor: surface.overlay,
          backgroundImage: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: surface.overlay,
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      variants: [...neutralButton],
      defaultProps: {
        color: 'default',
        disableElevation: true,
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
    MuiToggleButton: {
      styleOverrides: {
        root: {
          border: 'none',
          borderRadius: 8,
          color: 'rgba(255, 255, 255, 0.6)',
          textTransform: 'none',
          '&.Mui-selected': {
            backgroundColor: surface.hover,
            color: white,
          },
          '&.Mui-selected:hover': {
            backgroundColor: surface.hover,
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        grouped: {
          border: 'none',
          borderRadius: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 3,
        },
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
  },
});
