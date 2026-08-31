import { Stack } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { ProjectBackButton } from './buttons/ProjectBackButton.js';

export type ProjectLayoutProps = {
  children: ReactNode;
  heading?: ReactNode;
};
export const ProjectLayout: FC<ProjectLayoutProps> = (props) => {
  const { children, heading } = props;
  const headingContent = heading ?? <ProjectBackButton />;

  return (
    <Stack
      height='100dvh'
      position='relative'
      p={2}
      gap={2}
      sx={(theme) => ({
        paddingTop: `calc(${theme.spacing(2)} + env(safe-area-inset-top, 0px))`,
        paddingBottom: `calc(${theme.spacing(2)} + env(safe-area-inset-bottom, 0px))`,
        paddingLeft: `calc(${theme.spacing(2)} + env(safe-area-inset-left, 0px))`,
        paddingRight: `calc(${theme.spacing(2)} + env(safe-area-inset-right, 0px))`,
      })}
    >
      <Stack direction='row' gap={2} alignItems='center' position='relative'>
        {headingContent}
      </Stack>
      {children}
    </Stack>
  );
};
