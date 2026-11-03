import { Box, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useRef } from 'react';
import { SubtitleCurrentLineButton } from './SubtitleCurrentLineButton.js';
import { SubtitleLoopHandles } from './SubtitleLoopHandles.js';
import { SubtitleSegment } from './SubtitleSegment.js';
import { useSubtitleCursor } from './useSubtitleCursor.js';
import { useSubtitleFollowScroll } from './useSubtitleFollowScroll.js';

export type SubtitleListProps = {
  subtitle: api.subtitle.Segment[];
};

export const SubtitleList: FC<SubtitleListProps> = (props) => {
  const { subtitle } = props;
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const subtitleCursor = useSubtitleCursor(subtitle);
  const centerCurrentLine = useSubtitleFollowScroll(
    subtitle,
    subtitleCursor,
    subtitleListRef,
  );

  return (
    <Box
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}
    >
      <Stack
        ref={subtitleListRef}
        component='div'
        sx={{
          alignItems: 'center',
          width: '100%',
          height: '100%',
          minHeight: 0,
          position: 'relative',
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarGutter: 'stable',
        }}
      >
        <Box sx={{ height: 'calc(50% - 2em)', flexShrink: 0 }} />
        {subtitle.map((segment, index) => (
          <SubtitleSegment
            key={`${segment.start}-${index}`}
            index={index}
            segment={segment}
            subtitleCursor={subtitleCursor}
          />
        ))}
        <Box sx={{ height: 'calc(50% - 2em)', flexShrink: 0 }} />
        <SubtitleLoopHandles subtitle={subtitle} />
      </Stack>
      <SubtitleCurrentLineButton
        listRef={subtitleListRef}
        cursor={subtitleCursor}
        onClick={centerCurrentLine}
      />
    </Box>
  );
};
