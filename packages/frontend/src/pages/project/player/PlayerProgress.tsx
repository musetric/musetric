import { Box, Slider, sliderClasses, Stack, Typography } from '@mui/material';
import { type EngineState, getTrackProgress } from '@musetric/engine';
import { type FC, useLayoutEffect, useRef } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';
import { engine } from '../../../engine/engine.js';
import { subscribeEnginePosition } from '../../../engine/enginePosition.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { LoopProgressRange } from '../loop/LoopProgressRange.js';
import { useSeekDrag } from './useSeekDrag.js';

const progressScale = 1000;

const getPosition = (frameIndex: number, state: EngineState) =>
  Math.round(getTrackProgress(frameIndex, state.frameCount) * progressScale);

const getCurrentTime = (frameIndex: number, state: EngineState) =>
  formatDuration(
    getTrackProgress(frameIndex, state.frameCount) * state.duration,
  );

const writePosition = (slider: HTMLElement, position: number) => {
  const percent = `${(position * 100) / progressScale}%`;
  const track = slider.querySelector<HTMLElement>(`.${sliderClasses.track}`);
  const thumb = slider.querySelector<HTMLElement>(`.${sliderClasses.thumb}`);
  const input = slider.querySelector('input');
  if (track) track.style.width = percent;
  if (thumb) thumb.style.left = percent;
  if (input) {
    input.value = String(position);
    input.setAttribute('aria-valuenow', String(position));
  }
};

export const PlayerProgress: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const disabled = !frameCount || realtimeFailed;
  useSeekDrag(ref, 'playerProgress', disabled);

  useLayoutEffect(() => {
    const slider = sliderRef.current;
    const time = timeRef.current;
    if (!slider || !time) return;
    const write = () => {
      const frameIndex = engine.position.read();
      const state = engine.store.get();
      writePosition(slider, getPosition(frameIndex, state));
      time.textContent = getCurrentTime(frameIndex, state);
    };
    write();
    const unsubscribes = [
      subscribeEnginePosition(getPosition, (position) => {
        writePosition(slider, position);
      }),
      subscribeEnginePosition(getCurrentTime, (text) => {
        time.textContent = text;
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, []);

  return (
    <Stack direction='row' sx={{ alignItems: 'center', gap: 2 }}>
      <Typography
        ref={timeRef}
        variant='caption'
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      <Box
        ref={ref}
        sx={{ flexGrow: 1, mx: 1.5, position: 'relative', display: 'flex' }}
      >
        <Slider
          ref={sliderRef}
          min={0}
          max={progressScale}
          value={getPosition(engine.position.read(), engine.store.get())}
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
