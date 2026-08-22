import { darken, lighten } from '@mui/material/styles';

export const createColor = (main: string) => ({
  50: lighten(main, 0.9),
  100: lighten(main, 0.7),
  200: lighten(main, 0.5),
  300: lighten(main, 0.3),
  400: lighten(main, 0.1),
  500: main,
  600: darken(main, 0.1),
  700: darken(main, 0.3),
  800: darken(main, 0.5),
  900: darken(main, 0.7),
  A100: lighten(main, 0.8),
  A200: lighten(main, 0.6),
  A400: lighten(main, 0.4),
  A700: darken(main, 0.4),
});

export const white = '#FFFFFF';
export const black = '#000000';
export const neutral = createColor('#96BEE6');

export const surface = {
  background: '#0A0A0C',
  raised: '#141419',
  overlay: '#1C1C23',
  hover: '#23232B',
};

export const accent = createColor('#7FB2F0');

export const outline = {
  subtle: 'rgba(255, 255, 255, 0.08)',
  strong: 'rgba(255, 255, 255, 0.16)',
};
