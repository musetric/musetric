import { Box } from '@mui/material';
import { createNumberLimit } from '@musetric/resource-utils';
import { createInertialDrag } from '@musetric/resource-utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { SpectrogramNoteScale } from '../spectrogram/SpectrogramNoteScale/index.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    let { frameIndex } = engine.store.get();

    const drag = createInertialDrag({
      element,
      onStart: () => {
        engine.player.setFrozen(true);
        frameIndex = engine.store.get().frameIndex;
      },
      onUpdate: (event) => {
        const { frameCount } = engine.store.get();
        const { width } = element.getBoundingClientRect();

        if (!frameCount || width <= 0) {
          event.stop();
          return;
        }

        const { visibleTime } = useSettingsStore.getState();
        const frameLimit = createNumberLimit({
          minimum: 0,
          maximum: frameCount,
        });
        const frameDelta =
          (-event.delta * visibleTime * engine.context.sampleRate) / width;
        const rawFrameIndex = frameIndex + frameDelta;
        const nextFrameIndex = frameLimit.clamp(rawFrameIndex);

        frameIndex = nextFrameIndex;
        engine.player.seek(Math.round(nextFrameIndex));

        if (
          event.phase === 'inertia' &&
          (rawFrameIndex < 0 || rawFrameIndex > frameCount)
        ) {
          event.stop();
        }
      },
      onEnd: () => {
        engine.player.setFrozen(false);
      },
    });

    return () => {
      drag.dispose();
      engine.player.setFrozen(false);
    };
  }, []);

  return (
    <Box
      ref={ref}
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
      gridTemplateRows='minmax(0, 1fr) auto'
      position='relative'
      minHeight={0}
      minWidth={0}
    >
      <Box height='100%' position='relative'>
        <SpectrogramCanvas />
        <SpectrogramNoteScale />
        <VisualizationCursor />
      </Box>
      <VisualizationTimeline />
    </Box>
  );
};
