import { alpha, Box, Typography } from '@mui/material';
import type { FC } from 'react';
import { getNoteScaleColor } from './noteLineStyle.js';
import { type NoteMarker } from './noteMarker.js';

export type NoteScaleMarkerProps = NoteMarker;

export const NoteScaleMarker: FC<NoteScaleMarkerProps> = (props) => {
  const { label, tone, topRatio } = props;

  return (
    <Box
      position='absolute'
      top={`${topRatio * 100}%`}
      right={0}
      left={0}
      height={0}
      sx={{
        borderTop: '1px solid',
        borderColor: (theme) => getNoteScaleColor(theme, tone),
      }}
    >
      {tone !== 'gray' && (
        <Typography
          variant='caption'
          position='absolute'
          top={0}
          left={6}
          px={0.5}
          lineHeight='12px'
          sx={{
            color: (theme) => getNoteScaleColor(theme, tone),
            bgcolor: (theme) => alpha(theme.palette.background.default, 0.6),
            transform: 'translateY(-50%)',
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
};
