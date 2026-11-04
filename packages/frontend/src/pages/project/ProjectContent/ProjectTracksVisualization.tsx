import { alpha, Box, Typography } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC, useEffect, useRef } from 'react';
import { type TrackVolumeTarget } from '../mix/trackVolume.js';
import { TrackVolumeCell } from '../mix/TrackVolumeCell.js';
import { keepSystemGesturesOut } from '../systemGestures.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import { WaveformCanvas } from '../waveform/WaveformCanvas.js';
import {
  playedWidthVariable,
  useTracksCursorTime,
} from './useTracksCursorTime.js';
import { useTracksSeekDrag } from './useTracksSeekDrag.js';

const nameColumnWidth = 116;

const tracks: readonly TrackVolumeTarget[] = [
  { kind: 'recording' },
  ...stemTypes.map((stemType) => ({ kind: 'delivery' as const, stemType })),
];

const getTrackKey = (track: TrackVolumeTarget) =>
  track.kind === 'recording' ? track.kind : track.stemType;

const rowsSx = {
  display: 'grid',
  gridTemplateRows: `repeat(${tracks.length}, minmax(0, 1fr))`,
  rowGap: 1,
  minWidth: 0,
  minHeight: 0,
} as const;

export const ProjectTracksVisualization: FC = () => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  useTracksSeekDrag(lanesRef);
  useTracksCursorTime(lanesRef, timeRef);
  useEffect(() => {
    const surface = surfaceRef.current;
    return surface ? keepSystemGesturesOut(surface) : undefined;
  }, []);

  return (
    <Box
      ref={surfaceRef}
      sx={{
        display: 'grid',
        gridTemplateColumns: `${nameColumnWidth}px minmax(0, 1fr)`,
        columnGap: 1,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box sx={rowsSx}>
        {tracks.map((track) => (
          <TrackVolumeCell key={getTrackKey(track)} target={track} />
        ))}
      </Box>
      <Box ref={lanesRef} sx={{ ...rowsSx, position: 'relative' }}>
        {tracks.map((track) => (
          <Box
            key={getTrackKey(track)}
            sx={{
              position: 'relative',
              isolation: 'isolate',
              overflow: 'hidden',
              borderRadius: 1.5,
              bgcolor: 'background.default',
              minHeight: 0,
              cursor: 'ew-resize',
            }}
          >
            <WaveformCanvas {...track} />
            <Box
              sx={(theme) => ({
                position: 'absolute',
                inset: 0,
                transform: `translateX(var(${playedWidthVariable}, 0px))`,
                bgcolor: alpha(theme.palette.background.default, 0.6),
                pointerEvents: 'none',
                willChange: 'transform',
              })}
            />
          </Box>
        ))}
        <VisualizationCursor mode='tracks' />
        <Typography
          ref={timeRef}
          variant='caption'
          sx={{
            position: 'absolute',
            top: 2,
            left: 0,
            px: 1,
            borderRadius: 1,
            bgcolor: 'common.black',
            color: 'primary.main',
            lineHeight: 1.2,
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        />
      </Box>
    </Box>
  );
};
