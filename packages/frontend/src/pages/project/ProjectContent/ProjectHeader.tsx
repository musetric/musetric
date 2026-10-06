import { Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { ProjectHomeButton } from '../buttons/ProjectHomeButton.js';
import { ProjectHeaderMenu } from '../menu/ProjectHeaderMenu.js';

export const ProjectHeader: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const project = useQuery(endpoints.project.get(projectId));

  return (
    <Stack
      gridArea='header'
      direction='row'
      alignItems='center'
      gap={1}
      minWidth={0}
    >
      <ProjectHomeButton />
      <Typography
        variant='subtitle1'
        lineHeight={1.5}
        textAlign='center'
        noWrap
        flexGrow={1}
        minWidth={0}
      >
        {project.data?.name}
      </Typography>
      <ProjectHeaderMenu />
    </Stack>
  );
};
