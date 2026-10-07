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
      height='100dvh'
      position='relative'
      gap={2}
      sx={(theme) => ({
        ...safeAreaPadding(theme, 2),
        bgcolor: framed ? getPageBackground(theme) : undefined,
      })}
    >
      {heading && (
        <Stack direction='row' gap={2} alignItems='center' position='relative'>
          {heading}
        </Stack>
      )}
      {children}
    </Stack>
  );
};
