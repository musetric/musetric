import { alpha, Box, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC, useRef } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { getPageBackground } from '../pageBackground.js';
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

const deckEdgeLimit = 2;

export const ProjectTracksVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useTracksSeekDrag(ref);
  const deckEdges = useEngineStore((state) =>
    Math.max(0, Math.min(state.recordings.length - 1, deckEdgeLimit)),
  );

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
          <Stack>
            <Box sx={laneSx}>
              <WaveformCanvas kind='recording' />
            </Box>
            {Array.from({ length: deckEdges }, (_, edge) => (
              <Box
                key={edge}
                height={4}
                mx={2 * (edge + 1)}
                sx={(theme) => ({
                  borderRadius: '0 0 6px 6px',
                  bgcolor: alpha(
                    theme.palette.background.default,
                    edge === 0 ? 0.7 : 0.45,
                  ),
                })}
              />
            ))}
          </Stack>
          {stemTypes.map((stemType) => (
            <Box key={stemType} sx={laneSx}>
              <WaveformCanvas kind='delivery' stemType={stemType} />
            </Box>
          ))}
          <VisualizationCursor mode='tracks' />
        </Stack>
        <Box
          position='sticky'
          bottom={0}
          zIndex={2}
          sx={(theme) => ({
            pointerEvents: 'none',
            bgcolor: getPageBackground(theme),
          })}
        >
          <VisualizationTimeline mode='tracks' />
        </Box>
      </Box>
    </Box>
  );
};
