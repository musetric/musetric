import { Box, Paper, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC, useRef } from 'react';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';
import { WaveformCanvas } from '../waveform/WaveformCanvas.js';
import { useTracksSeekDrag } from './useTracksSeekDrag.js';

export const ProjectTracksVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useTracksSeekDrag(ref);

  return (
    <Box height='100%' overflow='auto' sx={{ userSelect: 'none' }}>
      <Box
        ref={ref}
        display='grid'
        gridTemplateRows='1fr auto'
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
          <VisualizationCursor mode='tracks' />
        </Stack>
        <Box position='sticky' bottom={0} sx={{ pointerEvents: 'none' }}>
          <VisualizationTimeline mode='tracks' />
        </Box>
      </Box>
    </Box>
  );
};
