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
  const playingColor = active ? 'action.selected' : 'action.hover';

  return (
    <Box
      width={128}
      height={48}
      px={1}
      display='flex'
      alignItems='center'
      borderRadius={999}
      sx={{
        backgroundColor: recording ? 'error.dark' : playingColor,
        opacity: frameCount ? 1 : 0.5,
        transition: 'background-color 160ms linear',
      }}
    >
      <PlaybackRecordButton />
      {!active && <PlaybackPlayButton />}
      {active && <PlaybackStopButton />}
    </Box>
  );
};
