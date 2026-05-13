import { Box, Stack } from '@mui/material';
import { type FC } from 'react';
import { DetailsModeToggle } from '../buttons/detailsModeToggle/index.js';
import { PlayPauseButton } from '../buttons/PlayPauseButton.js';
import { VisualizationModeToggle } from '../buttons/visualizationModeToggle/index.js';
import { PlayerProgress } from './PlayerProgress.js';

export const PlaybackPanel: FC = () => {
  return (
    <Stack width='100%'>
      <PlayerProgress />
      <Box
        width='100%'
        display='grid'
        gridTemplateColumns='minmax(0, 1fr) auto minmax(0, 1fr)'
        alignItems='center'
      >
        <Stack gridColumn={1} direction='row' gap={1}>
          <VisualizationModeToggle />
        </Stack>
        <Box gridColumn={2}>
          <PlayPauseButton />
        </Box>
        <Stack gridColumn={3} direction='row' gap={1} justifySelf='end'>
          <DetailsModeToggle />
        </Stack>
      </Box>
    </Stack>
  );
};
