import { Slider, Stack, Typography } from '@mui/material';
import { getTrackProgress } from '@musetric/engine';
import { isPrimaryPointerButton } from '@musetric/interaction';
import { type FC, useEffect, useRef } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';
import { engine } from '../../../engine/engine.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const progressScale = 1000;

export const PlayerProgress: FC = () => {
  const ref = useRef<HTMLSpanElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );

  const initialProgress = getTrackProgress(engine.store.get());

  useEffect(() => {
    const root = ref.current;

    const apply = (progress: number) => {
      const percent = `${progress * 100}%`;

      const track = root?.querySelector<HTMLElement>('.MuiSlider-track');
      if (track) {
        track.style.width = percent;
      }

      const thumb = root?.querySelector<HTMLElement>('.MuiSlider-thumb');
      if (thumb) {
        thumb.style.left = percent;
      }

      const input = root?.querySelector('input');
      if (input) {
        const value = String(Math.round(progress * progressScale));
        input.value = value;
        input.setAttribute('aria-valuenow', value);
      }

      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = formatDuration(
          progress * duration,
        );
      }
    };

    apply(getTrackProgress(engine.store.get()));

    return engine.store.subscribe(getTrackProgress, apply);
  }, [duration]);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const freeze = createInteractionFreeze();

    const handlePointerDown = (event: PointerEvent) => {
      if (!isPrimaryPointerButton(event)) return;
      if (!event.isPrimary) return;
      freeze.freeze();
    };

    const handlePointerUp = freeze.release;

    element.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
      freeze.release();
    };
  }, []);

  return (
    <Stack direction='row' alignItems='center' gap={3}>
      <Typography
        ref={currentTimeRef}
        variant='caption'
        color='text.secondary'
        width={40}
        flexShrink={0}
      >
        {formatDuration(initialProgress * duration)}
      </Typography>
      <Slider
        ref={ref}
        min={0}
        max={progressScale}
        defaultValue={Math.round(initialProgress * progressScale)}
        disabled={!frameCount || realtimeFailed}
        size='small'
        sx={{
          flexGrow: 1,
          '& .MuiSlider-thumb': {
            color: 'primary.main',
          },
          '& .MuiSlider-track': {
            color: 'primary.main',
          },
        }}
        onChange={(_, value) => {
          if (!frameCount) {
            return;
          }

          const frameIndex = Math.round((value / progressScale) * frameCount);
          engine.player.seek(frameIndex, 'playerProgress');
        }}
      />
      <Typography
        variant='caption'
        color='text.secondary'
        width={40}
        flexShrink={0}
        textAlign='right'
      >
        {formatDuration(duration)}
      </Typography>
    </Stack>
  );
};
