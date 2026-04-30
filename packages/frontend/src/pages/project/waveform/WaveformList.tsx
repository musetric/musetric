import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { WaveformCanvas } from './WaveformCanvas.js';

export type WaveformListProps = {
  projectId: number;
};

export const WaveformList: FC<WaveformListProps> = (props) => {
  const { projectId } = props;

  return (
    <Stack gap={1} height='100%' overflow='auto'>
      {stemTypes.map((stemType) => (
        <Box
          key={stemType}
          component={Paper}
          elevation={3}
          height={100}
          flexShrink={0}
        >
          <WaveformCanvas projectId={projectId} stemType={stemType} />
        </Box>
      ))}
    </Stack>
  );
};
