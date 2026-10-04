import { Box } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';

export type SubtitleWordProps = {
  word: api.subtitle.Word;
};

export const SubtitleWord: FC<SubtitleWordProps> = (props) => {
  const { word } = props;

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
