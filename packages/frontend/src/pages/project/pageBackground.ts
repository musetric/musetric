import { getOverlayAlpha, lighten, type Theme } from '@mui/material/styles';

const pageElevation = 8;

export const getPageBackground = (theme: Theme): string =>
  lighten(theme.palette.background.paper, getOverlayAlpha(pageElevation));
