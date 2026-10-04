import { Box, Stack } from '@mui/material';
import { type FC } from 'react';
import { MetronomeToggleButton } from '../buttons/MetronomeToggleButton.js';
import { PlaybackControlsButton } from '../buttons/PlaybackControlsButton.js';
import { SubtitlesToggleButton } from '../buttons/SubtitlesToggleButton.js';
import { TempoButton } from '../buttons/TempoButton.js';
import { TransposeButton } from '../buttons/TransposeButton.js';
import { VisualizationModeToggle } from '../buttons/visualizationModeToggle/index.js';
import { PlayerProgress } from './PlayerProgress.js';

const dockAreas = {
  xs: '"view view view" "practice transport song"',
  sm: '"controls transport view"',
};

const dockColumns = {
  xs: 'auto 1fr auto',
  sm: '1fr auto 1fr',
};

export const PlaybackPanel: FC = () => (
  <Stack width='100%'>
    <PlayerProgress />
    <Box
      display='grid'
      alignItems='center'
      columnGap={2}
      rowGap={2}
      gridTemplateAreas={dockAreas}
      gridTemplateColumns={dockColumns}
    >
      <Box
        gridArea='controls'
        display={{ xs: 'contents', sm: 'flex' }}
        alignItems='center'
        gap={1}
      >
        <Stack gridArea='practice' direction='row' alignItems='center' gap={1}>
          <SubtitlesToggleButton />
          <MetronomeToggleButton />
        </Stack>
        <Stack gridArea='song' direction='row' alignItems='center' gap={1}>
          <TransposeButton />
          <TempoButton />
        </Stack>
      </Box>
      <Box gridArea='transport' justifySelf='center'>
        <PlaybackControlsButton />
      </Box>
      <Box gridArea='view' justifySelf={{ xs: 'stretch', sm: 'end' }}>
        <VisualizationModeToggle />
      </Box>
    </Box>
  </Stack>
);
