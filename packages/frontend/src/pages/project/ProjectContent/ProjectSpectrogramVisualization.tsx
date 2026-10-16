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
import { createLoopRangeGesture } from '../loop/createLoopRangeGesture.js';
import { LoopOverlay } from '../loop/LoopOverlay.js';
import { LoopPictureControls } from '../loop/LoopPictureControls.js';
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

const loopControlsBottom = 64;

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
  useSpectrogramGesture(spectrogramAreaRef, createLoopRangeGesture);

  return (
    <Box
      ref={ref}
      sx={{
        gridArea: 'picture',
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto',
        position: 'relative',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: chordsOpen
            ? 'auto minmax(0, 1fr)'
            : 'minmax(0, 1fr)',
          rowGap: 1,
          position: 'relative',
          minHeight: 0,
        }}
      >
        {chordsOpen && <ChordLane />}
        <Box
          ref={spectrogramAreaRef}
          sx={{ height: '100%', position: 'relative' }}
        >
          <SpectrogramCanvas />
          <LoopOverlay />
          <SpectrogramNoteScale />
          {spectrum ? (
            <>
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: leadBandTop,
                  left: noteNamesInset,
                  pointerEvents: 'none',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    zIndex: 1,
                    pointerEvents: 'auto',
                  }}
                >
                  <RecordingPicker variant='picture' />
                </Box>
                {emptyRecordingName !== undefined && (
                  <Typography
                    variant='body2'
                    sx={{
                      color: 'text.secondary',
                      position: 'absolute',
                      top: '50%',
                      left: 0,
                      right: 0,
                      textAlign: 'center',
                      transform: 'translateY(-50%)',
                    }}
                  >
                    {t('pages.project.recording.emptyBand', {
                      name: emptyRecordingName,
                    })}
                  </Typography>
                )}
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  top: leadBandTop,
                  right: 0,
                  bottom: 0,
                  left: noteNamesInset,
                  pointerEvents: 'none',
                }}
              >
                <TrackLabel
                  kind='delivery'
                  stemType='lead'
                  variant='spectrogram'
                />
              </Box>
            </>
          ) : (
            <Box
              sx={{
                position: 'absolute',
                top: 8,
                left: notesPickerInset,
                zIndex: 1,
              }}
            >
              <RecordingPicker variant='picture' />
            </Box>
          )}
        </Box>
        <VisualizationCursor mode='spectrogram' />
      </Box>
      <VisualizationTimeline mode='spectrogram' />
      <Box
        sx={{
          position: 'absolute',
          top: `${chordBlockInset}px`,
          right: `${chordBlockInset}px`,
          height: `${chordLaneHeight - 2 * chordBlockInset}px`,
          display: 'flex',
          zIndex: 1,
        }}
      >
        <ChordsToggleButton />
      </Box>
      <Box
        sx={{
          position: 'absolute',
          right: 8,
          bottom: loopControlsBottom,
          zIndex: 2,
        }}
      >
        <LoopPictureControls />
      </Box>
    </Box>
  );
};
