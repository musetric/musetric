import { createTheme } from '@mui/material';

export const theme = createTheme({
  palette: {
    background: {
      default: '#f7f4ef',
      paper: '#fffaf2',
    },
    primary: {
      main: '#ff6b4a',
      contrastText: '#171614',
    },
    secondary: {
      main: '#6fd6c5',
    },
    text: {
      primary: '#171614',
      secondary: 'rgba(23, 22, 20, 0.68)',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontWeight: 900,
      letterSpacing: 0,
    },
    h2: {
      fontWeight: 850,
      letterSpacing: 0,
    },
    h3: {
      fontWeight: 850,
      letterSpacing: 0,
    },
    button: {
      fontWeight: 850,
      letterSpacing: 0,
      textTransform: 'none',
    },
  },
});
