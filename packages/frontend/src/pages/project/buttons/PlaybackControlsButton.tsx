import { Box } from '@mui/material';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { PlaybackPlayButton } from './PlaybackPlayButton.js';
import { PlaybackRecordButton } from './PlaybackRecordButton.js';
import { PlaybackStopButton } from './PlaybackStopButton.js';

export type PlaybackControlsButtonProps = {
  projectId: number;
};

export const PlaybackControlsButton: FC<PlaybackControlsButtonProps> = (
  props,
) => {
  const { projectId } = props;
  const frameCount = useEngineStore((state) => state.frameCount);
  const playing = useEngineStore((state) => state.playing);
  const recording = useEngineStore((state) => state.recording);
  const active = playing || recording;

  const getBorderColor = () => {
    if (!frameCount) {
      return 'divider';
    }
    if (recording) {
      return 'error.main';
    }
    return 'text.primary';
  };
  const borderColor = getBorderColor();

  return (
    <Box
      width={82}
      height={34}
      px={0.5}
      display='flex'
      alignItems='center'
      border='1px solid'
      borderRadius={999}
      borderColor={borderColor}
    >
      {!active && <PlaybackRecordButton projectId={projectId} />}
      {!active && (
        <Box width='1px' height={20} bgcolor={borderColor} flexShrink={0} />
      )}
      {!active && <PlaybackPlayButton />}
      {active && <PlaybackStopButton />}
    </Box>
  );
};
