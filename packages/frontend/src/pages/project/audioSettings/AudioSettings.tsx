import { Box, Drawer, Stack } from '@mui/material';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { AudioInputSelect } from './AudioInputSelect.js';
import { AudioOutputSelect } from './AudioOutputSelect.js';
import { AudioSettingsError } from './AudioSettingsError.js';
import { AudioSettingsHeader } from './AudioSettingsHeader.js';
import { AudioSettingsLifecycle } from './AudioSettingsLifecycle.js';
import { InputLevelMeter } from './InputLevelMeter.js';
import { RecordingGainControl } from './RecordingGainControl.js';
import { RecordingLatencyControl } from './RecordingLatencyControl.js';

export const AudioSettings: FC = () => {
  const open = useProjectStore((state) => state.audioSettingsOpen);
  const setOpen = useProjectStore((state) => state.setAudioSettingsOpen);

  return (
    <Drawer anchor='right' open={open} onClose={() => setOpen(false)}>
      <AudioSettingsLifecycle>
        <Box width={340} p={2} role='presentation'>
          <Stack gap={4}>
            <AudioSettingsHeader />
            <AudioSettingsError />
            <AudioOutputSelect />
            <AudioInputSelect />
            <InputLevelMeter />
            <RecordingGainControl />
            <RecordingLatencyControl />
          </Stack>
        </Box>
      </AudioSettingsLifecycle>
    </Drawer>
  );
};
