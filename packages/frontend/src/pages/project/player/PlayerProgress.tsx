import { Box, Slider, Stack, Typography } from '@mui/material';
import { getTrackProgress } from '@musetric/engine';
import { type FC, useRef } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';
import { useEnginePosition } from '../../../engine/enginePosition.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { LoopProgressRange } from '../loop/LoopProgressRange.js';
import { useSeekDrag } from './useSeekDrag.js';

const progressScale = 1000;

export const PlayerProgress: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const disabled = !frameCount || realtimeFailed;
  const position = useEnginePosition((frameIndex, state) =>
    Math.round(getTrackProgress(frameIndex, state.frameCount) * progressScale),
  );
  const currentTime = useEnginePosition((frameIndex, state) =>
    formatDuration(
      getTrackProgress(frameIndex, state.frameCount) * state.duration,
    ),
  );
  useSeekDrag(ref, 'playerProgress', disabled);

  return (
    <Stack direction='row' sx={{ alignItems: 'center', gap: 2 }}>
      <Typography
        variant='caption'
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {currentTime}
      </Typography>
      <Box
        ref={ref}
        sx={{ flexGrow: 1, mx: 1.5, position: 'relative', display: 'flex' }}
      >
        <Slider
          min={0}
          max={progressScale}
          value={position}
          disabled={disabled}
          tabIndex={-1}
          size='small'
          sx={{
            pointerEvents: 'none',
            '& .MuiSlider-thumb': {
              color: 'primary.main',
              transitionProperty: 'box-shadow',
            },
            '& .MuiSlider-track': {
              color: 'primary.main',
              transitionProperty: 'none',
            },
          }}
        />
        <LoopProgressRange />
      </Box>
      <Typography
        variant='caption'
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatDuration(duration)}
      </Typography>
    </Stack>
  );
};
