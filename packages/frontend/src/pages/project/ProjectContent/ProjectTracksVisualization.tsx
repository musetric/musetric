import { Box, Stack } from '@mui/material';
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
    <Box
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
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
              height={80}
              flexShrink={0}
              borderRadius={2}
              overflow='hidden'
              sx={{ backgroundColor: 'background.paper' }}
            >
              <WaveformCanvas kind='delivery' stemType={stemType} />
            </Box>
          ))}
          <Box
            height={80}
            flexShrink={0}
            borderRadius={2}
            overflow='hidden'
            sx={{ backgroundColor: 'background.paper' }}
          >
            <WaveformCanvas kind='recording' />
          </Box>
          <VisualizationCursor />
        </Stack>
        <Box position='sticky' bottom={0} sx={{ pointerEvents: 'none' }}>
          <VisualizationTimeline />
        </Box>
      </Box>
    </Box>
  );
};
