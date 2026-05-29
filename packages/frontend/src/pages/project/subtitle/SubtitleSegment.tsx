import { Box } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC } from 'react';
import { type SubtitleCursor } from './subtitleCursor.js';
import { SubtitleSegmentText } from './SubtitleSegmentText.js';
import { useSubtitlePlaybackTime } from './useSubtitlePlaybackTime.js';
import { useSubtitleSegmentStatus } from './useSubtitleSegmentStatus.js';

type ActiveSubtitleSegmentProps = {
  segment: api.subtitle.Segment;
  chordSegments: api.chords.ChordSegment[];
};

const ActiveSubtitleSegment: FC<ActiveSubtitleSegmentProps> = (props) => {
  const { segment, chordSegments } = props;
  const playbackTime = useSubtitlePlaybackTime();

  return (
    <SubtitleSegmentText
      playbackTime={playbackTime}
      segment={segment}
      status='active'
      chordSegments={chordSegments}
    />
  );
};

export type SubtitleSegmentProps = {
  index: number;
  segment: api.subtitle.Segment;
  subtitleCursor: SubtitleCursor;
  chordSegments: api.chords.ChordSegment[];
};

export const SubtitleSegment: FC<SubtitleSegmentProps> = (props) => {
  const { index, segment, subtitleCursor, chordSegments } = props;
  const status = useSubtitleSegmentStatus(index, subtitleCursor);

  return (
    <Box data-subtitle-segment-index={index} py={1}>
      {status === 'active' ? (
        <ActiveSubtitleSegment
          segment={segment}
          chordSegments={chordSegments}
        />
      ) : (
        <SubtitleSegmentText
          segment={segment}
          status={status}
          chordSegments={chordSegments}
        />
      )}
    </Box>
  );
};
