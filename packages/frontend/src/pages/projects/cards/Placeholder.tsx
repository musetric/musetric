import { Box, Skeleton, Stack } from '@mui/material';
import { type FC } from 'react';

export const PlaceholderCard: FC = () => (
  <Box>
    <Skeleton
      variant='rectangular'
      sx={{ aspectRatio: '1 / 1', borderRadius: 2 }}
    />
    <Stack pt={1.5} gap={0.5}>
      <Skeleton variant='text' width='70%' />
      <Skeleton variant='text' width='45%' />
    </Stack>
  </Box>
);
