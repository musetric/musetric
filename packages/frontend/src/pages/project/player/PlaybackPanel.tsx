import { Box, Stack, type Theme } from '@mui/material';
import { type FC } from 'react';
import { MetronomeToggleButton } from '../buttons/MetronomeToggleButton.js';
import { PlaybackControlsButton } from '../buttons/PlaybackControlsButton.js';
import { RecordingHistoryButtons } from '../buttons/RecordingHistoryButtons.js';
import { TempoButton } from '../buttons/TempoButton.js';
import { TransposeButton } from '../buttons/TransposeButton.js';
import { DetailsViewToggle } from '../buttons/viewToggle/DetailsViewToggle.js';
import { SpectrogramViewToggle } from '../buttons/viewToggle/SpectrogramViewToggle.js';
import { LessonButton } from '../lesson/LessonButton.js';
import { LoopTries } from '../loop/LoopTries.js';
import { MixButton } from '../mix/MixButton.js';
import { PlayerProgress } from './PlayerProgress.js';

const desktopAreas =
  '"details history . click mix transport key tempo . learn spectrogram"';

const desktopColumns = 'auto auto 1fr auto auto auto auto auto 1fr auto auto';

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
  <Stack sx={{ width: '100%' }}>
    <LoopTries />
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
        <Box sx={{ gridArea: 'details' }}>
          <DetailsViewToggle />
        </Box>
        <Box sx={{ gridArea: 'history' }}>
          <RecordingHistoryButtons />
        </Box>
        <Box sx={{ gridArea: 'learn' }}>
          <LessonButton />
        </Box>
        <Box sx={{ gridArea: 'spectrogram' }}>
          <SpectrogramViewToggle />
        </Box>
      </Box>
      <Box sx={phoneRowSx}>
        <Box sx={{ gridArea: 'click' }}>
          <MetronomeToggleButton />
        </Box>
        <Box sx={{ gridArea: 'mix' }}>
          <MixButton />
        </Box>
        <Box sx={{ gridArea: 'transport' }}>
          <PlaybackControlsButton />
        </Box>
        <Box sx={{ gridArea: 'key' }}>
          <TransposeButton />
        </Box>
        <Box sx={{ gridArea: 'tempo' }}>
          <TempoButton />
        </Box>
      </Box>
    </Box>
  </Stack>
);
