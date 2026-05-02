import { Box } from '@mui/material';
import { type FC, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { useProjectStore } from '../store.js';
import {
  useVisualizationScrollbarWidth,
  visualizationScrollbarWidthProperty,
} from '../visualization/useVisualizationScrollbarWidth.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { getVisualizationFrameIndex } from '../visualization/visualizationSeek.js';
import {
  timelineHeight,
  VisualizationTimeline,
} from '../visualization/VisualizationTimeline.js';
import {
  hiddenTrackListScrollbarSx,
  useTrackListScroll,
} from '../waveform/useTrackListScroll.js';
import { WaveformList } from '../waveform/WaveformList.js';

export const ProjectVisualization: FC = () => {
  const visualizationMode = useProjectStore((state) => state.visualizationMode);
  const detailsMode = useProjectStore((state) => state.detailsMode);
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useTrackListScroll(visualizationMode === 'waveform');
  useVisualizationScrollbarWidth(
    containerRef,
    rootRef,
    `${visualizationMode}:${detailsMode}`,
  );

  return (
    <Box
      ref={rootRef}
      gridArea='visualization'
      position='relative'
      sx={{ [visualizationScrollbarWidthProperty]: '0px' }}
    >
      <Box
        ref={containerRef}
        height='100%'
        overflow='auto'
        pb={`${timelineHeight}px`}
        onClick={(event) => {
          const newFrameIndex = getVisualizationFrameIndex(event);
          if (newFrameIndex === undefined) return;
          engine.player.seek(newFrameIndex);
        }}
        sx={
          visualizationMode === 'waveform' && detailsMode === 'mixer'
            ? hiddenTrackListScrollbarSx
            : undefined
        }
      >
        {visualizationMode === 'waveform' && <WaveformList />}
        {visualizationMode === 'spectrogram' && <SpectrogramCanvas />}
      </Box>
      <Box
        position='absolute'
        top={0}
        right={`var(${visualizationScrollbarWidthProperty})`}
        bottom={0}
        left={0}
        zIndex={1}
        sx={{ pointerEvents: 'none' }}
      >
        <VisualizationCursor />
        <VisualizationTimeline />
      </Box>
    </Box>
  );
};
