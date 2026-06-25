import { Box, Slider, Typography } from '@mui/material';
import { subscribeResizeObserver } from '@musetric/resource-utils/dom';
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
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
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

  useEffect(() => {
    const element = ref.current;
    const currentTimeElement = currentTimeRef.current;

    if (!element || !currentTimeElement) {
      return;
    }

    const input = element.querySelector<HTMLInputElement>(
      'input[type="range"]',
    );
    const thumb = element.querySelector<HTMLElement>('.MuiSlider-thumb');
    const track = element.querySelector<HTMLElement>('.MuiSlider-track');
    let progressWidth = element.getBoundingClientRect().width;

    if (thumb) {
      thumb.style.left = '0%';
    }

    if (track) {
      track.style.left = '0%';
      track.style.transformOrigin = 'left center';
      track.style.width = '100%';
    }

    const update = () => {
      const state = engine.store.get();
      const nextProgress = getTrackProgress(state);
      const nextValue = String(Math.round(nextProgress * progressScale));
      const currentTime = formatTime(nextProgress * state.duration);

      if (input) {
        if (input.value !== nextValue) {
          input.value = nextValue;
        }
        if (input.getAttribute('aria-valuenow') !== nextValue) {
          input.setAttribute('aria-valuenow', nextValue);
        }
      }

      if (thumb) {
        const translate = `${nextProgress * progressWidth}px`;
        if (thumb.style.translate !== translate) {
          thumb.style.translate = translate;
        }
      }

      if (track) {
        const transform = `scaleX(${nextProgress})`;
        if (track.style.transform !== transform) {
          track.style.transform = transform;
        }
      }

      if (currentTimeElement.textContent !== currentTime) {
        currentTimeElement.textContent = currentTime;
      }
    };

    update();

    const unsubscribeResizeObserver = subscribeResizeObserver(element, () => {
      progressWidth = element.getBoundingClientRect().width;
      update();
    });
    const unsubscribeProgress = engine.store.subscribe(
      getTrackProgress,
      update,
    );

    return () => {
      unsubscribeProgress();
      unsubscribeResizeObserver();
    };
  }, [duration, frameCount]);

  return (
    <Box position='relative'>
      <Slider
        ref={ref}
        min={0}
        max={progressScale}
        defaultValue={Math.round(
          getTrackProgress(engine.store.get()) * progressScale,
        )}
        disabled={!frameCount || realtimeFailed}
        size='small'
        sx={{
          '& .MuiSlider-thumb': {
            color: 'primary.main',
            willChange: 'translate',
          },
          '& .MuiSlider-track': {
            transformOrigin: 'left center',
            willChange: 'transform',
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
        ref={currentTimeRef}
        variant='caption'
        position='absolute'
        top='calc(100% - 12px)'
        left={0}
        lineHeight={1}
      >
        {formatTime(getTrackProgress(engine.store.get()) * duration)}
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
