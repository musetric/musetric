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
        mx={1}
        position='relative'
      >
        <Box
          display='grid'
          mx={-1}
          px={1}
          bgcolor='background.default'
          borderRadius={2}
        >
          <Stack position='relative' gap={1} py={1}>
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
        </Box>
        <Box
          position='sticky'
          bottom={0}
          bgcolor='grey.900'
          zIndex={2}
          sx={{ pointerEvents: 'none' }}
        >
          <VisualizationTimeline mode='tracks' />
        </Box>
      </Box>
    </Box>
  );
};
