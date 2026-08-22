import { Stack } from '@mui/material';
import { type FC } from 'react';
import { PlaybackControlsButton } from '../buttons/PlaybackControlsButton.js';
import { SubtitlesToggleButton } from '../buttons/SubtitlesToggleButton.js';
import { VisualizationModeToggle } from '../buttons/visualizationModeToggle/index.js';
import { MixButton } from '../mix/MixButton.js';
import { PlayerProgress } from './PlayerProgress.js';

export const PlaybackPanel: FC = () => (
  <Stack width='100%' gap={3}>
    <PlayerProgress />
    <Stack
      direction='row'
      alignItems='center'
      justifyContent='space-between'
      gap={3}
    >
      <Stack direction='row' alignItems='center' gap={1}>
        <SubtitlesToggleButton />
        <MixButton />
      </Stack>
      <PlaybackControlsButton />
      <VisualizationModeToggle />
    </Stack>
  </Stack>
);
