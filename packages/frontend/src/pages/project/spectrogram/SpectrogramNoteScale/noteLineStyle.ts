import { alpha } from '@mui/material';
import { type Theme } from '@mui/material/styles';
import { type NoteLineTone } from './noteMarker.js';

const getBaseColor = (theme: Theme, tone: NoteLineTone) => {
  const colors: Record<NoteLineTone, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    gray: theme.palette.grey[400],
  };
  return colors[tone];
};

const getColorAlpha = (tone: NoteLineTone) => {
  const alphas: Record<NoteLineTone, number> = {
    primary: 0.9,
    secondary: 0.55,
    gray: 0.2,
  };
  return alphas[tone];
};

export const getNoteScaleColor = (theme: Theme, tone: NoteLineTone) =>
  alpha(getBaseColor(theme, tone), getColorAlpha(tone));
