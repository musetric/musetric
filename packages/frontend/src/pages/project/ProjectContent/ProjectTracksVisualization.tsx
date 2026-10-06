import { Box, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC, useRef } from 'react';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';
import { WaveformCanvas } from '../waveform/WaveformCanvas.js';
import { useTracksSeekDrag } from './useTracksSeekDrag.js';

const laneSx = {
  height: 80,
  flexShrink: 0,
  overflow: 'hidden',
  borderRadius: 2,
  bgcolor: 'background.default',
} as const;

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
        <Stack position='relative' gap={2}>
          {stemTypes.map((stemType) => (
            <Box key={stemType} sx={laneSx}>
              <WaveformCanvas kind='delivery' stemType={stemType} />
            </Box>
          ))}
          <Box sx={laneSx}>
            <WaveformCanvas kind='recording' />
          </Box>
          <VisualizationCursor mode='tracks' />
        </Stack>
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
