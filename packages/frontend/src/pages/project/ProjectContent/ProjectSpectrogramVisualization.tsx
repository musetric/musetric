import { Box } from '@mui/material';
import { type FC, useRef } from 'react';
import {
  chordBlockInset,
  ChordLane,
  chordLaneHeight,
} from '../chords/ChordLane.js';
import { ChordsToggleButton } from '../chords/ChordsToggleButton.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { SpectrogramNoteScale } from '../spectrogram/SpectrogramNoteScale/index.js';
import { useSpectrogramGesture } from '../spectrogram/useSpectrogramGesture.js';
import { useProjectStore } from '../store.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);
  const chordsOpen = useProjectStore((state) => state.chordsOpen);
  useSpectrogramGesture(spectrogramAreaRef);

  return (
    <Box
      ref={ref}
      flex={{
        xs: '2 1 0',
        md: '1 1 0',
      }}
      display='grid'
      gridTemplateRows={
        chordsOpen ? 'auto minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto'
      }
      position='relative'
      minHeight={0}
      minWidth={0}
    >
      {chordsOpen && <ChordLane />}
      <Box ref={spectrogramAreaRef} height='100%' position='relative'>
        <SpectrogramCanvas />
        <SpectrogramNoteScale />
        <VisualizationCursor />
      </Box>
      <VisualizationTimeline />
      <Box
        position='absolute'
        top={`${chordBlockInset}px`}
        right={0}
        height={`${chordLaneHeight - 2 * chordBlockInset}px`}
        display='flex'
        zIndex={1}
      >
        <ChordsToggleButton />
      </Box>
    </Box>
  );
};
