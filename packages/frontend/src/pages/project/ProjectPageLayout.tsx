import { Stack } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { safeAreaPadding } from '../../app/theme/safeArea.js';
import { getPageBackground } from './pageBackground.js';

export type ProjectLayoutProps = {
  children: ReactNode;
  heading?: ReactNode;
  framed?: boolean;
};
export const ProjectLayout: FC<ProjectLayoutProps> = (props) => {
  const { children, heading, framed } = props;

  return (
    <Stack
      sx={[
        {
          height: '100dvh',
          position: 'relative',
          gap: 2,
        },
        (theme) => ({
          ...safeAreaPadding(theme, 2),
          bgcolor: framed ? getPageBackground(theme) : undefined,
        }),
      ]}
    >
      {heading && (
        <Stack
          direction='row'
          sx={{ gap: 2, alignItems: 'center', position: 'relative' }}
        >
          {heading}
        </Stack>
      )}
      {children}
    </Stack>
  );
};
