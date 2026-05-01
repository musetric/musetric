import { alpha, Box, Typography } from '@mui/material';
import { type Theme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { type FC } from 'react';

const getWordColor = (
  word: api.subtitle.Word,
  playbackTime: number,
  theme: Theme,
) => {
  if (playbackTime >= word.start && playbackTime < word.end) {
    return 'primary.main';
  }
  if (playbackTime >= word.end) {
    return alpha(
      theme.palette.text.primary,
      theme.palette.action.disabledOpacity,
    );
  }
  return 'text.primary';
};

const getSegmentEnd = (segment: api.subtitle.Segment) => {
  const words = segment.words;
  if (words.length > 0) {
    return words[words.length - 1].end;
  }
  return segment.end;
};

const getInactiveSegmentSx = (
  segment: api.subtitle.Segment,
  playbackTime: number,
) => {
  if (playbackTime >= getSegmentEnd(segment)) {
    return {
      color: 'text.secondary',
      opacity: 0.5,
    };
  }

  return {
    color: 'text.primary',
    opacity: 0.72,
  };
};

export type SegmentLCurrentProps = {
  active: boolean;
  segment?: api.subtitle.Segment;
  playbackTime: number;
};

export const SegmentLCurrent: FC<SegmentLCurrentProps> = (props) => {
  const { active, segment, playbackTime } = props;
  if (!segment) {
    return;
  }

  if (!active) {
    return (
      <Typography
        variant='h6'
        fontWeight='bold'
        lineHeight={1.18}
        color='text.secondary'
        textAlign='center'
        sx={{
          ...getInactiveSegmentSx(segment, playbackTime),
          transition: 'color 160ms linear, opacity 160ms linear',
        }}
      >
        {segment.text}
      </Typography>
    );
  }

  return (
    <Typography
      variant='h6'
      fontWeight='bold'
      textAlign='center'
      component='div'
      lineHeight={1.18}
    >
      {segment.words.map((word, index) => {
        return (
          <Box
            component='span'
            key={`${word.start}-${index}`}
            sx={{
              color: (theme) => getWordColor(word, playbackTime, theme),
              transition: 'color 120ms linear',
            }}
          >
            {word.text}
            {index < segment.words.length - 1 ? ' ' : ''}
          </Box>
        );
      })}
    </Typography>
  );
};
