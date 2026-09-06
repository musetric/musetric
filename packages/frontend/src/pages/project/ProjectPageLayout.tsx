import { Stack } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { safeAreaPadding } from '../../app/theme/safeArea.js';
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
      gap={2}
      sx={(theme) => safeAreaPadding(theme, 2)}
    >
      <Stack direction='row' gap={2} alignItems='center' position='relative'>
        {headingContent}
      </Stack>
      {children}
    </Stack>
  );
};
