import { Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, Fragment } from 'react';
import { SubtitleWord } from './SubtitleWord.js';

const inactiveTransition = 'color 160ms linear, opacity 160ms linear';

export type SubtitleSegmentTextProps = {
  segment: api.subtitle.Segment;
};

export const SubtitleSegmentText: FC<SubtitleSegmentTextProps> = (props) => {
  const { segment } = props;

  return (
    <Typography
      variant='h5'
      sx={{
        fontSize: { xs: '1.125rem', sm: '1.5rem' },
        '@media (orientation: landscape) and (max-height: 500px)': {
          fontSize: '1.125rem',
        },
        fontWeight: 'bold',
        lineHeight: 1.18,
        textAlign: 'center',
        ':where([data-subtitle-segment-status="past"]) > &': {
          color: 'text.secondary',
          opacity: 0.5,
          transition: inactiveTransition,
        },
        ':where([data-subtitle-segment-status="future"]) > &': {
          color: 'text.primary',
          opacity: 0.72,
          transition: inactiveTransition,
        },
      }}
    >
      {segment.words.length > 0
        ? segment.words.map((word, index) => (
            <Fragment key={`${word.start}-${index}`}>
              <SubtitleWord word={word} index={index} />
              {index < segment.words.length - 1 ? ' ' : ''}
            </Fragment>
          ))
        : segment.text}
    </Typography>
  );
};
