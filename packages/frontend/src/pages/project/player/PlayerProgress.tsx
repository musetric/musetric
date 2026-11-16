import { Box, Slider, Stack, Typography } from '@mui/material';
import { getTrackProgress } from '@musetric/engine';
import { isPrimaryPointerButton } from '@musetric/interaction';
import { type FC, useEffect, useRef } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';
import { engine } from '../../../engine/engine.js';
import { createInteractionFreeze } from '../../../engine/interactionFreeze.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playHaptic } from '../haptics.js';
import { LoopProgressRange } from '../loop/LoopProgressRange.js';

const progressScale = 1000;

export const PlayerProgress: FC = () => {
  const ref = useRef<HTMLSpanElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const atEdgeRef = useRef(false);
  const frameCount = useEngineStore((state) => state.frameCount);
  const duration = useEngineStore((state) => state.duration);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );

  const initialProgress = getTrackProgress(engine.store.get());

  useEffect(() => {
    const root = ref.current;
    const track = root?.querySelector<HTMLElement>('.MuiSlider-track');
    const thumb = root?.querySelector<HTMLElement>('.MuiSlider-thumb');
    const input = root?.querySelector('input');
    const currentTime = currentTimeRef.current;
    if (!root || !track || !thumb || !input || !currentTime) {
      return;
    }

    let devicePixels = 0;
    let shownPixel: number | undefined = undefined;
    let shownValue: string | undefined = undefined;
    let shownTime: string | undefined = undefined;

    const apply = (progress: number) => {
      if (devicePixels > 0) {
        const pixel = Math.round(progress * devicePixels);
        if (pixel !== shownPixel) {
          shownPixel = pixel;
          const percent = `${(pixel / devicePixels) * 100}%`;
          track.style.width = percent;
          thumb.style.left = percent;
        }
      }

      const value = String(Math.round(progress * progressScale));
      if (value !== shownValue) {
        shownValue = value;
        input.value = value;
        input.setAttribute('aria-valuenow', value);
      }

      const time = formatDuration(progress * duration);
      if (time !== shownTime) {
        shownTime = time;
        currentTime.textContent = time;
      }
    };

    const observer = new ResizeObserver(() => {
      devicePixels = root.clientWidth * window.devicePixelRatio;
      shownPixel = undefined;
      apply(getTrackProgress(engine.store.get()));
    });
    observer.observe(root);

    const unsubscribe = engine.store.subscribe(getTrackProgress, apply);

    return () => {
      unsubscribe();
      observer.disconnect();
    };
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
      atEdgeRef.current = false;
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
    <Stack direction='row' sx={{ alignItems: 'center', gap: 2 }}>
      <Typography
        ref={currentTimeRef}
        variant='caption'
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatDuration(initialProgress * duration)}
      </Typography>
      <Box sx={{ flexGrow: 1, mx: 1.5, position: 'relative', display: 'flex' }}>
        <Slider
          ref={ref}
          min={0}
          max={progressScale}
          defaultValue={Math.round(initialProgress * progressScale)}
          disabled={!frameCount || realtimeFailed}
          size='small'
          sx={{
            '& .MuiSlider-thumb': {
              color: 'primary.main',
              transitionProperty: 'box-shadow',
            },
            '& .MuiSlider-track': {
              color: 'primary.main',
              transitionProperty: 'none',
            },
          }}
          onChange={(_, value) => {
            if (!frameCount) {
              return;
            }

            const atEdge = value <= 0 || value >= progressScale;
            if (atEdge && !atEdgeRef.current) {
              playHaptic('detent');
            }
            atEdgeRef.current = atEdge;
            const frameIndex = Math.round((value / progressScale) * frameCount);
            engine.player.seek(frameIndex, 'playerProgress');
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
