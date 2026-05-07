import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { WaveformCanvas } from './WaveformCanvas.js';

export const WaveformList: FC = () => {
  return (
    <Stack gap={1} minHeight='100%'>
      {stemTypes.map((stemType) => (
        <Box
          key={stemType}
          component={Paper}
          elevation={3}
          height={80}
          flexShrink={0}
        >
          <WaveformCanvas stemType={stemType} />
        </Box>
      ))}
    </Stack>
  );
};
