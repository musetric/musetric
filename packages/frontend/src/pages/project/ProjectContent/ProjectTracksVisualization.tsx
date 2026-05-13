import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { engine } from '../../../engine/engine.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { getWaveformFrameIndex } from '../visualization/visualizationSeek.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';
import { TrackVolumeControl } from '../waveform/TrackVolumeControl.js';
import { WaveformCanvas } from '../waveform/WaveformCanvas.js';

export const ProjectTracksVisualization: FC = () => {
  return (
    <Box
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
      gridTemplateColumns={{
        xs: 'minmax(0, 1fr) 200px',
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
        display='grid'
        gridTemplateRows='1fr auto'
        alignSelf='start'
        height='100%'
        position='relative'
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const newFrameIndex = getWaveformFrameIndex(event);
          if (newFrameIndex === undefined) return;
          engine.player.seek(newFrameIndex);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const newFrameIndex = getWaveformFrameIndex(event);
          if (newFrameIndex === undefined) return;
          engine.player.seek(newFrameIndex);
        }}
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
