import { Box } from '@mui/material';
import { type FC, useRef } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
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
import { TrackLabel } from '../waveform/TrackLabel.js';

export const ProjectSpectrogramVisualization: FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);
  const chordsOpen = useProjectStore((state) => state.chordsOpen);
  const spectrum = useEngineStore(
    (state) => state.spectrogramView === 'spectrum',
  );
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
        {spectrum && (
          <>
            <TrackLabel kind='delivery' stemType='lead' />
            <Box
              position='absolute'
              top='50%'
              right={0}
              bottom={0}
              left={0}
              sx={{ pointerEvents: 'none' }}
            >
              <TrackLabel kind='recording' />
            </Box>
          </>
        )}
        <VisualizationCursor mode='spectrogram' />
      </Box>
      <VisualizationTimeline mode='spectrogram' />
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
