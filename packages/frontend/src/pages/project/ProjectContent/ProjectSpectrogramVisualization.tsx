import { Box, Typography } from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { stackedLaneGap } from '@musetric/spectrogram';
import { type FC, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import {
  chordBlockInset,
  ChordLane,
  chordLaneHeight,
} from '../chords/ChordLane.js';
import { ChordsToggleButton } from '../chords/ChordsToggleButton.js';
import { RecordingPicker } from '../recording/RecordingPicker.js';
import { SpectrogramCanvas } from '../spectrogram/SpectrogramCanvas.js';
import { SpectrogramNoteScale } from '../spectrogram/SpectrogramNoteScale/index.js';
import { useSpectrogramGesture } from '../spectrogram/useSpectrogramGesture.js';
import { useProjectStore } from '../store.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { VisualizationTimeline } from '../visualization/VisualizationTimeline.js';
import { TrackLabel } from '../waveform/TrackLabel.js';

const noteNamesInset = 16;

const leadBandTop = `calc(50% + ${stackedLaneGap / 2}px)`;

const notesPickerInset = 32;

export const ProjectSpectrogramVisualization: FC = () => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const spectrogramAreaRef = useRef<HTMLDivElement>(null);
  const emptyRecordingName = useEngineStore((state) => {
    const active = getActiveRecording(state);
    return active?.empty && !state.recording ? active.name : undefined;
  });
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
          {spectrum ? (
            <>
              <Box
                position='absolute'
                top={0}
                right={0}
                bottom={leadBandTop}
                left={noteNamesInset}
                sx={{ pointerEvents: 'none' }}
              >
                <Box
                  position='absolute'
                  top={8}
                  left={8}
                  zIndex={1}
                  sx={{ pointerEvents: 'auto' }}
                >
                  <RecordingPicker variant='picture' />
                </Box>
                {emptyRecordingName !== undefined && (
                  <Typography
                    variant='body2'
                    color='text.secondary'
                    position='absolute'
                    top='50%'
                    left={0}
                    right={0}
                    textAlign='center'
                    sx={{ transform: 'translateY(-50%)' }}
                  >
                    {t('pages.project.recording.emptyBand', {
                      name: emptyRecordingName,
                    })}
                  </Typography>
                )}
              </Box>
              <Box
                position='absolute'
                top={leadBandTop}
                right={0}
                bottom={0}
                left={noteNamesInset}
                sx={{ pointerEvents: 'none' }}
              >
                <TrackLabel
                  kind='delivery'
                  stemType='lead'
                  variant='spectrogram'
                />
              </Box>
            </>
          ) : (
            <Box position='absolute' top={8} left={notesPickerInset} zIndex={1}>
              <RecordingPicker variant='picture' />
            </Box>
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
