import { alpha, Typography } from '@mui/material';
import { type FC } from 'react';
import { chordBlockInset } from '../chords/ChordLane.js';
import { type TrackVolumeTarget } from '../mix/trackVolume.js';
import {
  pictureLabelHeight,
  pictureLabelMinWidth,
} from '../visualization/pictureLabel.js';
import { useTrackName } from './trackName.js';

export type TrackLabelProps = TrackVolumeTarget & {
  variant: 'spectrogram' | 'inline';
};

export const TrackLabel: FC<TrackLabelProps> = (props) => {
  const label = useTrackName(props);

  if (props.variant === 'inline') {
    return (
      <Typography variant='subtitle2' sx={{ color: 'text.primary' }}>
        {label}
      </Typography>
    );
  }

  return (
    <Typography
      variant='caption'
      sx={[
        {
          fontWeight: 600,
          lineHeight: 1,
        },
        (theme) => ({
          position: 'absolute',
          top: chordBlockInset,
          left: 8,
          display: 'flex',
          alignItems: 'center',
          minWidth: pictureLabelMinWidth,
          height: pictureLabelHeight,
          px: 0.75,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          color: theme.palette.text.primary,
          backgroundColor: alpha(theme.palette.common.black, 0.8),
          zIndex: 1,
          pointerEvents: 'none',
        }),
      ]}
    >
      {label}
    </Typography>
  );
};
