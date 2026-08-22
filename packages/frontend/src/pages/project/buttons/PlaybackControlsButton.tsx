import { Box } from '@mui/material';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { PlaybackPlayButton } from './PlaybackPlayButton.js';
import { PlaybackRecordButton } from './PlaybackRecordButton.js';
import { PlaybackStopButton } from './PlaybackStopButton.js';

export const PlaybackControlsButton: FC = () => {
  const frameCount = useEngineStore((state) => state.frameCount);
  const playing = useEngineStore((state) => state.playing);
  const recording = useEngineStore((state) => state.recording);
  const active = playing || recording;

  return (
    <Box
      width={96}
      height={40}
      px={1}
      display='flex'
      alignItems='center'
      borderRadius={999}
      sx={{
        backgroundColor: recording ? 'error.dark' : 'background.paper',
        opacity: frameCount ? 1 : 0.5,
        transition: 'background-color 160ms linear',
      }}
    >
      {!active && <PlaybackRecordButton />}
      {!active && <PlaybackPlayButton />}
      {active && <PlaybackStopButton />}
    </Box>
  );
};
