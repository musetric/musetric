import { Box, Card, CardActions, CircularProgress } from '@mui/material';
import { type FC } from 'react';
import { ProjectPreview } from './Preview.js';

export const PlaceholderCard: FC = () => (
  <Card sx={{ background: 'none', boxShadow: 'none' }}>
    <ProjectPreview>
      <CircularProgress sx={{ color: 'text.primary' }} />
    </ProjectPreview>
    <CardActions>
      <Box width='100%' height='3em' />
    </CardActions>
  </Card>
);
