import { alpha, Box } from '@mui/material';
import { type Theme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { type FC } from 'react';

const getSubtitleWordColor = (
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

export type SubtitleWordProps = {
  playbackTime?: number;
  word: api.subtitle.Word;
};

export const SubtitleWord: FC<SubtitleWordProps> = (props) => {
  const { playbackTime, word } = props;

  return (
    <Box
      component='span'
      data-subtitle-word-start={word.start}
      sx={{
        color:
          playbackTime !== undefined
            ? (theme) => getSubtitleWordColor(word, playbackTime, theme)
            : 'inherit',
        cursor: 'pointer',
        display: 'inline-block',
        transition: 'color 120ms linear',
      }}
    >
      {word.text}
    </Box>
  );
};
