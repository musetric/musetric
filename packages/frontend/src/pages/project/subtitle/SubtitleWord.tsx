import { alpha, Box } from '@mui/material';
import { type Theme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { type WordChord } from './subtitleChords.js';

const getTimedColor = (
  start: number,
  end: number,
  playbackTime: number,
  theme: Theme,
) => {
  if (playbackTime >= start && playbackTime < end) {
    return 'primary.main';
  }

  if (playbackTime >= end) {
    return alpha(
      theme.palette.text.primary,
      theme.palette.action.disabledOpacity,
    );
  }

  return 'text.primary';
};

export type SubtitleWordProps = {
  playbackTime?: number;
  word: api.subtitle.Word;
  chord?: WordChord;
};

export const SubtitleWord: FC<SubtitleWordProps> = (props) => {
  const { playbackTime, word, chord } = props;

  const wordColor =
    playbackTime !== undefined
      ? (theme: Theme) =>
          getTimedColor(word.start, word.end, playbackTime, theme)
      : 'inherit';

  const chordColor =
    playbackTime !== undefined && chord
      ? (theme: Theme) =>
          getTimedColor(chord.start, chord.end, playbackTime, theme)
      : 'inherit';

  return (
    <Box
      component='span'
      data-subtitle-word-start={word.start}
      sx={{
        cursor: 'pointer',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        verticalAlign: 'top',
      }}
    >
      <Box
        component='span'
        sx={{
          height: '1.15em',
          lineHeight: 1,
          fontSize: '0.62em',
          fontWeight: 700,
          color: chordColor,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          pointerEvents: 'none',
          transition: 'color 120ms linear',
        }}
      >
        {chord?.label ?? ' '}
      </Box>
      <Box
        component='span'
        sx={{
          color: wordColor,
          display: 'inline-block',
          transition: 'color 120ms linear',
        }}
      >
        {word.text}
      </Box>
    </Box>
  );
};
