import { Box } from '@mui/material';
import { type FC } from 'react';
import { ProjectDetails } from './ProjectDetails.js';
import { ProjectVisualization } from './ProjectVisualization.js';

export const ProjectContent: FC = () => (
  <Box
    display='flex'
    flexDirection={{
      xs: 'column',
      md: 'row',
    }}
    width='100%'
    flexGrow={1}
    minHeight={0}
    gap={1}
    overflow='hidden'
  >
    <ProjectDetails />
    <ProjectVisualization />
  </Box>
);
