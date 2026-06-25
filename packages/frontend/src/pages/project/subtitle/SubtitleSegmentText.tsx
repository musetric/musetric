import { Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, Fragment, useMemo } from 'react';
import { getWordChordLabels } from './subtitleChords.js';
import { type SubtitleSegmentStatus } from './subtitleTiming.js';
import { SubtitleWord } from './SubtitleWord.js';

const getInactiveSubtitleSegmentSx = (status: SubtitleSegmentStatus) => {
  if (status === 'past') {
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

export type SubtitleSegmentTextProps = {
  segment: api.subtitle.Segment;
  status: SubtitleSegmentStatus;
  chordSegments: api.chords.ChordSegment[];
};

export const SubtitleSegmentText: FC<SubtitleSegmentTextProps> = (props) => {
  const { segment, status, chordSegments } = props;
  const active = status === 'active';

  const chordLabels = useMemo(
    () => getWordChordLabels(segment.words, chordSegments),
    [segment.words, chordSegments],
  );

  return (
    <Typography
      variant='h5'
      fontWeight='bold'
      lineHeight={1.18}
      textAlign='center'
      sx={
        active
          ? undefined
          : {
              ...getInactiveSubtitleSegmentSx(status),
              transition: 'color 160ms linear, opacity 160ms linear',
            }
      }
    >
      {segment.words.length > 0
        ? segment.words.map((word, index) => (
            <Fragment key={`${word.start}-${index}`}>
              <SubtitleWord word={word} chord={chordLabels[index]} />
              {index < segment.words.length - 1 ? ' ' : ''}
            </Fragment>
          ))
        : segment.text}
    </Typography>
  );
};
