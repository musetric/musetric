import { Box } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { type WordChord } from './subtitleChords.js';

export type SubtitleWordProps = {
  word: api.subtitle.Word;
  chord?: WordChord;
};

export const SubtitleWord: FC<SubtitleWordProps> = (props) => {
  const { word, chord } = props;

  return (
    <Box
      component='span'
      data-subtitle-word-start={word.start}
      data-subtitle-word-end={word.end}
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
        data-subtitle-chord-start={chord?.start}
        data-subtitle-chord-end={chord?.end}
        sx={{
          height: '1.15em',
          lineHeight: 1,
          fontSize: '0.62em',
          fontWeight: 700,
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
        data-subtitle-word-text=''
        sx={{
          display: 'inline-block',
          transition: 'color 120ms linear',
        }}
      >
        {word.text}
      </Box>
    </Box>
  );
};
