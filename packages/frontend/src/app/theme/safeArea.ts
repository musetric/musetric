import { type Theme } from '@mui/material';

export const safeAreaPadding = (theme: Theme, spacing: number) => {
  const base = theme.spacing(spacing);
  return {
    paddingTop: `max(${base}, env(safe-area-inset-top))`,
    paddingRight: `max(${base}, env(safe-area-inset-right))`,
    paddingBottom: `max(${base}, env(safe-area-inset-bottom))`,
    paddingLeft: `max(${base}, env(safe-area-inset-left))`,
  };
};
