import { Stack, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { safeAreaPadding } from '../../app/theme/safeArea.js';
import { ProjectBackButton } from './buttons/ProjectBackButton.js';

export type ProjectLayoutProps = {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
};
export const ProjectLayout: FC<ProjectLayoutProps> = (props) => {
  const { children, title, actions } = props;

  return (
    <Stack
      height='100dvh'
      position='relative'
      gap={3}
      sx={(theme) => safeAreaPadding(theme, 3)}
    >
      <Stack direction='row' gap={3} alignItems='center' position='relative'>
        <ProjectBackButton />
        <Typography variant='h6' noWrap flexGrow={1} minWidth={0}>
          {title}
        </Typography>
        {actions}
      </Stack>
      {children}
    </Stack>
  );
};
