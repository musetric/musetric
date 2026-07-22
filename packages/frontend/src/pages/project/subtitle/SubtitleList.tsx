import { Box, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { useQuery } from '@tanstack/react-query';
import { type FC, useRef } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { SubtitleSegment } from './SubtitleSegment.js';
import { useSubtitleCursor } from './useSubtitleCursor.js';
import { useSubtitleFollowScroll } from './useSubtitleFollowScroll.js';

const emptyChordSegments: api.chords.ChordSegment[] = [];

export type SubtitleListProps = {
  subtitle: api.subtitle.Segment[];
};

export const SubtitleList: FC<SubtitleListProps> = (props) => {
  const { subtitle } = props;
  const { projectId } = routes.project.useAssertMatch();
  const chordsQuery = useQuery(endpoints.chords.get(projectId));
  const chordSegments = chordsQuery.data?.segments ?? emptyChordSegments;
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const subtitleCursor = useSubtitleCursor(subtitle);
  useSubtitleFollowScroll(subtitle, subtitleCursor, subtitleListRef);

  return (
    <Stack
      ref={subtitleListRef}
      component='div'
      alignItems='center'
      width='100%'
      height='100%'
      minHeight={0}
      overflow='auto'
      sx={{
        scrollbarGutter: 'stable',
      }}
    >
      <Box height='calc(50% - 2em)' flexShrink={0} />
      {subtitle.map((segment, index) => (
        <SubtitleSegment
          key={`${segment.start}-${index}`}
          index={index}
          segment={segment}
          subtitleCursor={subtitleCursor}
          chordSegments={chordSegments}
        />
      ))}
      <Box height='calc(50% - 2em)' flexShrink={0} />
    </Stack>
  );
};
