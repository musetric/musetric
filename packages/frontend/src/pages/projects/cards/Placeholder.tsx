import { Skeleton, Stack } from '@mui/material';
import { type FC } from 'react';

export const PlaceholderCard: FC = () => (
  <Stack
    direction='row'
    alignItems='center'
    gap={3}
    padding={2}
    borderRadius={2}
    bgcolor='action.hover'
  >
    <Skeleton
      variant='rectangular'
      sx={{
        width: { xs: 64, sm: 80 },
        aspectRatio: '1 / 1',
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
    <Stack flexGrow={1} gap={0.5}>
      <Skeleton variant='text' width='60%' />
      <Skeleton variant='text' width='35%' />
    </Stack>
  </Stack>
);
