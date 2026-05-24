import { Box, LinearProgress, Typography } from '@mui/material';
import { type FC } from 'react';
import { totalTasks, useProcessingStore } from '../store.js';

export const Progress: FC = () => {
  const remaining = useProcessingStore((state) => state.toDo.length);
  const done = totalTasks - remaining;
  const value = totalTasks > 0 ? (done / totalTasks) * 100 : 0;

  return (
    <Box sx={{ width: '100%', mb: 2, mt: 2 }}>
      <Typography variant='body2' sx={{ mt: 1, textAlign: 'center' }}>
        {`${String(done)} of ${String(totalTasks)} tasks completed`}
      </Typography>
      <LinearProgress variant='determinate' value={value} />
    </Box>
  );
};
