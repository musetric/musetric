import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { createNumberLimit } from '@musetric/resource-utils';
import { createSeekDrag } from '@musetric/resource-utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';
import { TrackVolumeControl } from '../waveform/TrackVolumeControl.js';
import { WaveformCanvas } from '../waveform/WaveformCanvas.js';

export const ProjectTracksVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    let startFrameIndex = 0;
    let releaseFrozenOnEnd = true;

    const drag = createSeekDrag({
      element,
      onStart: () => {
        releaseFrozenOnEnd = true;
        engine.player.setFrozen(true);
        startFrameIndex = engine.store.get().frameIndex;
      },
      onUpdate: (event) => {
        const { frameCount } = engine.store.get();
        if (!frameCount) {
          event.stop();
          return;
        }

        const frameIndex =
          event.pointerType === 'mouse'
            ? event.ratio * frameCount
            : startFrameIndex + event.offsetRatio * frameCount;
        const frameLimit = createNumberLimit({
          minimum: 0,
          maximum: frameCount,
        });
        const newFrameIndex = frameLimit.clamp(Math.round(frameIndex));

        engine.player.seek(newFrameIndex, 'tracksVisualization');
      },
      onEnd: () => {
        if (releaseFrozenOnEnd) {
          engine.player.setFrozen(false);
        }
        releaseFrozenOnEnd = true;
      },
    });
    const unsubscribeSeek = engine.store.subscribe(
      (state) => state.seekEvent.revision,
      () => {
        const { seekEvent } = engine.store.get();
        if (seekEvent.origin === 'tracksVisualization') {
          return;
        }

        releaseFrozenOnEnd = false;
        drag.stop();
      },
    );

    return () => {
      unsubscribeSeek();
      drag.dispose();
      engine.player.setFrozen(false);
    };
  }, []);

  return (
    <Box
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
      gridTemplateColumns={{
        xs: 'minmax(0, 1fr) 140px',
        sm: 'minmax(0, 1fr) 200px',
        lg: 'minmax(0, 1fr) 280px',
      }}
      gridTemplateRows='100%'
      gap={1}
      minHeight={0}
      minWidth={0}
      overflow='auto'
      sx={{ userSelect: 'none' }}
    >
      <Box
        ref={ref}
        display='grid'
        gridTemplateRows='1fr auto'
        alignSelf='start'
        height='100%'
        position='relative'
      >
        <Stack position='relative' gap={1}>
          {stemTypes.map((stemType) => (
            <Box
              key={stemType}
              component={Paper}
              elevation={3}
              height={80}
              flexShrink={0}
            >
              <WaveformCanvas kind='delivery' stemType={stemType} />
            </Box>
          ))}
          <Box component={Paper} elevation={3} height={80} flexShrink={0}>
            <WaveformCanvas kind='recording' />
          </Box>
          <VisualizationCursor />
        </Stack>
        <Box position='sticky' bottom={0} sx={{ pointerEvents: 'none' }}>
          <VisualizationTimeline />
        </Box>
      </Box>
      <Stack alignSelf='start' gap={1}>
        {stemTypes.map((stemType) => (
          <Stack key={stemType} height={80} flexShrink={0}>
            <TrackVolumeControl kind='delivery' stemType={stemType} />
          </Stack>
        ))}
        <Stack height={80} flexShrink={0}>
          <TrackVolumeControl kind='recording' />
        </Stack>
      </Stack>
    </Box>
  );
};
