import { Box, Stack, type Theme } from '@mui/material';
import { type FC } from 'react';
import { MetronomeToggleButton } from '../buttons/MetronomeToggleButton.js';
import { PlaybackControlsButton } from '../buttons/PlaybackControlsButton.js';
import { RecordingHistoryButtons } from '../buttons/RecordingHistoryButtons.js';
import { TempoButton } from '../buttons/TempoButton.js';
import { TransposeButton } from '../buttons/TransposeButton.js';
import { DetailsViewToggle } from '../buttons/viewToggle/DetailsViewToggle.js';
import { SpectrogramViewToggle } from '../buttons/viewToggle/SpectrogramViewToggle.js';
import { MixButton } from '../mix/MixButton.js';
import { PlayerProgress } from './PlayerProgress.js';

const desktopAreas =
  '"details history . click mix transport key tempo . spectrogram"';

const desktopColumns = 'auto auto 1fr auto auto auto auto auto 1fr auto';

const singleRowMinWidth = 680;

const phoneRowSx = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  [theme.breakpoints.up(singleRowMinWidth)]: {
    display: 'contents',
  },
});

export const PlaybackPanel: FC = () => (
  <Stack width='100%'>
    <PlayerProgress />
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        rowGap: 1,
        columnGap: 1,
        [theme.breakpoints.up(singleRowMinWidth)]: {
          display: 'grid',
          alignItems: 'center',
          gridTemplateAreas: desktopAreas,
          gridTemplateColumns: desktopColumns,
        },
      })}
    >
      <Box sx={phoneRowSx}>
        <Box gridArea='details'>
          <DetailsViewToggle />
        </Box>
        <Box gridArea='history'>
          <RecordingHistoryButtons />
        </Box>
        <Box gridArea='spectrogram'>
          <SpectrogramViewToggle />
        </Box>
      </Box>
      <Box sx={phoneRowSx}>
        <Box gridArea='click'>
          <MetronomeToggleButton />
        </Box>
        <Box gridArea='mix'>
          <MixButton />
        </Box>
        <Box gridArea='transport'>
          <PlaybackControlsButton />
        </Box>
        <Box gridArea='key'>
          <TransposeButton />
        </Box>
        <Box gridArea='tempo'>
          <TempoButton />
        </Box>
      </Box>
    </Box>
  </Stack>
);
