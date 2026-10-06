import { Box } from '@mui/material';
import { stackedLaneGap } from '@musetric/spectrogram';
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

const noteNamesInset = 16;

const recordingBandTop = `calc(50% + ${stackedLaneGap / 2}px)`;

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
      gridArea='picture'
      display='grid'
      gridTemplateRows='minmax(0, 1fr) auto'
      position='relative'
      minHeight={0}
      minWidth={0}
    >
      <Box
        display='grid'
        gridTemplateRows={chordsOpen ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)'}
        rowGap={1}
        position='relative'
        minHeight={0}
      >
        {chordsOpen && <ChordLane />}
        <Box ref={spectrogramAreaRef} height='100%' position='relative'>
          <SpectrogramCanvas />
          <SpectrogramNoteScale />
          {spectrum && (
            <>
              <Box
                position='absolute'
                top={0}
                right={0}
                bottom={recordingBandTop}
                left={noteNamesInset}
                sx={{ pointerEvents: 'none' }}
              >
                <TrackLabel
                  kind='delivery'
                  stemType='lead'
                  variant='spectrogram'
                />
              </Box>
              <Box
                position='absolute'
                top={recordingBandTop}
                right={0}
                bottom={0}
                left={noteNamesInset}
                sx={{ pointerEvents: 'none' }}
              >
                <TrackLabel kind='recording' variant='spectrogram' />
              </Box>
            </>
          )}
        </Box>
        <VisualizationCursor mode='spectrogram' />
      </Box>
      <VisualizationTimeline mode='spectrogram' />
      <Box
        position='absolute'
        top={`${chordBlockInset}px`}
        right={`${chordBlockInset}px`}
        height={`${chordLaneHeight - 2 * chordBlockInset}px`}
        display='flex'
        zIndex={1}
      >
        <ChordsToggleButton />
      </Box>
    </Box>
  );
};
