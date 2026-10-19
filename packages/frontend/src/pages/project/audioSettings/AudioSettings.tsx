import { Box, Divider, Drawer, Stack, useMediaQuery } from '@mui/material';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { AudioInputSelect } from './AudioInputSelect.js';
import { AudioOutputSelect } from './AudioOutputSelect.js';
import { AudioSettingsError } from './AudioSettingsError.js';
import { AudioSettingsHeader } from './AudioSettingsHeader.js';
import { AudioSettingsLifecycle } from './AudioSettingsLifecycle.js';
import { InputLevelMeter } from './InputLevelMeter.js';
import { RecordingGainControl } from './RecordingGainControl.js';
import { TimingRow } from './TimingRow.js';

export const AudioSettings: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const open = useProjectStore((state) => state.audioSettingsOpen);
  const setOpen = useProjectStore((state) => state.setAudioSettingsOpen);

  return (
    <Drawer
      anchor={isDesktop ? 'right' : 'bottom'}
      open={open}
      onClose={() => setOpen(false)}
    >
      <AudioSettingsLifecycle>
        <Box
          role='presentation'
          sx={
            isDesktop
              ? { width: 340, p: 2 }
              : {
                  width: '100%',
                  maxWidth: 460,
                  mx: 'auto',
                  boxSizing: 'border-box',
                  p: 4,
                  pb: 'max(18px, env(safe-area-inset-bottom))',
                }
          }
        >
          <Stack sx={{ gap: 4 }}>
            <AudioSettingsHeader />
            <AudioSettingsError />
            <AudioOutputSelect />
            <AudioInputSelect />
            <InputLevelMeter />
            <RecordingGainControl />
            <Divider />
            <TimingRow />
          </Stack>
        </Box>
      </AudioSettingsLifecycle>
    </Drawer>
  );
};
