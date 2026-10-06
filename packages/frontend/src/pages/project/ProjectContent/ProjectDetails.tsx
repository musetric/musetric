import { Box, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { ProjectBackButton } from '../buttons/ProjectBackButton.js';
import { ProjectHeaderMenu } from '../menu/ProjectHeaderMenu.js';
import { useProjectStore } from '../store.js';
import { Subtitle } from '../subtitle/Subtitle.js';
import { ProjectTracksVisualization } from './ProjectTracksVisualization.js';

export const ProjectDetails: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const project = useQuery(endpoints.project.get(projectId));
  const detailsView = useProjectStore((state) => state.detailsView);

  return (
    <Stack
      flex={{
        xs: '1 1 0',
        md: '0 0 420px',
      }}
      minHeight={0}
      minWidth={0}
      gap={1}
    >
      <Stack direction='row' alignItems='center' gap={1} flexShrink={0}>
        <ProjectBackButton />
        <Typography
          variant='h6'
          textAlign='center'
          noWrap
          flexGrow={1}
          minWidth={0}
        >
          {project.data?.name}
        </Typography>
        <ProjectHeaderMenu />
      </Stack>
      {detailsView === 'text' ? (
        <Box
          flex='1 1 0'
          minHeight={0}
          p={1}
          bgcolor='background.default'
          borderRadius={2}
          overflow='hidden'
        >
          <Subtitle />
        </Box>
      ) : (
        <Box flex='1 1 0' minHeight={0}>
          <ProjectTracksVisualization />
        </Box>
      )}
    </Stack>
  );
};
