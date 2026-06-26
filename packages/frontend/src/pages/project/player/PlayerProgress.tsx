import { Box, Slider, Typography } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
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
  const ref = useRef<HTMLSpanElement>(null);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const progress = useEngineStore((state) => getTrackProgress(state));
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    let sliderFrozen = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      if (!event.isPrimary) {
        return;
      }

      sliderFrozen = true;
      engine.player.setFrozen(true);
    };

    const handlePointerUp = () => {
      if (!sliderFrozen) {
        return;
      }

      sliderFrozen = false;
      engine.player.setFrozen(false);
    };

    element.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);

      if (sliderFrozen) {
        engine.player.setFrozen(false);
      }
    };
  }, []);

  return (
    <Box position='relative'>
      <Slider
        ref={ref}
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

          if (typeof value !== 'number') {
            return;
          }

          const frameIndex = Math.round((value / progressScale) * frameCount);
          engine.player.seek(frameIndex, 'playerProgress');
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
