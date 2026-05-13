import { Box, Slider, Typography } from '@mui/material';
import { type FC } from 'react';
import { engine } from '../../../engine/engine.js';
import { getTrackProgress } from '../../../engine/state.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const progressScale = 1000;

const formatTime = (timeInSeconds: number) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds - minutes * 60);

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const PlayerProgress: FC = () => {
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const progress = useEngineStore((state) => getTrackProgress(state));
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );

  return (
    <Box position='relative'>
      <Slider
        min={0}
        max={progressScale}
        value={Math.round(progress * progressScale)}
        disabled={!frameCount || realtimeFailed}
        size='small'
        sx={{
          '& .MuiSlider-thumb': {
            color: 'primary.main',
          },
        }}
        onChange={(_, value) => {
          if (!frameCount) {
            return;
          }

          const frameIndex = Math.round((value / progressScale) * frameCount);
          engine.player.seek(frameIndex);
        }}
      />
      <Typography
        variant='caption'
        position='absolute'
        top='calc(100% - 12px)'
        left={0}
        lineHeight={1}
      >
        {formatTime(progress * duration)}
      </Typography>
      <Typography
        variant='caption'
        position='absolute'
        top='calc(100% - 12px)'
        right={0}
        lineHeight={1}
      >
        {formatTime(duration)}
      </Typography>
    </Box>
  );
};
