import { Box, Skeleton, Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { ViewError } from '../../../components/ViewError.js';
import { getTrackProgress } from '../../../engine/state.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { SegmentLCurrent } from './SegmentLCurrent.js';

type SubtitleLines = {
  currentIndex: number;
};

const getSegmentEnd = (segment: api.subtitle.Segment) => {
  const words = segment.words;
  if (words.length > 0) {
    return words[words.length - 1].end;
  }
  return segment.end;
};

const getSubtitleLines = (
  subtitle: api.subtitle.Segment[],
  playbackTime: number,
): SubtitleLines => {
  if (subtitle.length === 0) {
    return {
      currentIndex: -1,
    };
  }

  const currentIndex = subtitle.findIndex(
    (segment) => playbackTime < getSegmentEnd(segment),
  );
  return { currentIndex };
};

const useAutoScrollPause = () => {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (!timeoutRef.current) {
        return;
      }
      window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return {
    autoScrollEnabled,
    pauseAutoScroll: () => {
      setAutoScrollEnabled(false);

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        setAutoScrollEnabled(true);
        timeoutRef.current = undefined;
      }, 5000);
    },
  };
};

export type SubtitleProps = {
  projectId: number;
};
export const Subtitle: FC<SubtitleProps> = (props) => {
  const { projectId } = props;
  const { t } = useTranslation();
  const subtitleQuery = useQuery(endpoints.subtitle.get(projectId));
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef(true);
  const { autoScrollEnabled, pauseAutoScroll } = useAutoScrollPause();

  const duration = useEngineStore((state) => state.duration);
  const trackProgress = useEngineStore(getTrackProgress);
  const playbackTime = duration * trackProgress;

  const { currentIndex } = getSubtitleLines(
    subtitleQuery.data ?? [],
    playbackTime,
  );

  useEffect(() => {
    if (!autoScrollEnabled) {
      return;
    }

    activeSegmentRef.current?.scrollIntoView({
      block: 'center',
      behavior: initialScrollRef.current ? 'instant' : 'smooth',
    });
    initialScrollRef.current = false;
  }, [autoScrollEnabled, currentIndex]);

  const getContent = () => {
    if (subtitleQuery.status === 'pending') {
      return (
        <>
          <Skeleton variant='text' width='60%' sx={{ fontSize: '1rem' }} />
          <Skeleton variant='text' width='35%' sx={{ fontSize: '1rem' }} />
        </>
      );
    }

    if (subtitleQuery.status === 'error') {
      return <ViewError message={t('pages.project.progress.error.lyrics')} />;
    }

    return (
      <Stack
        component='div'
        height='100%'
        width='100%'
        overflow='auto'
        tabIndex={0}
        onWheel={pauseAutoScroll}
        onTouchMove={pauseAutoScroll}
        onPointerDown={pauseAutoScroll}
        onKeyDown={pauseAutoScroll}
        sx={{
          scrollbarGutter: 'stable',
          scrollBehavior: 'smooth',
        }}
      >
        <Box height='calc(50% - 2em)' flexShrink={0} />
        {subtitleQuery.data.map((segment, index) => (
          <Box
            key={`${segment.start}-${index}`}
            ref={index === currentIndex ? activeSegmentRef : undefined}
            py={1}
          >
            <SegmentLCurrent
              active={index === currentIndex}
              segment={segment}
              playbackTime={playbackTime}
            />
          </Box>
        ))}
        <Box height='calc(50% - 2em)' flexShrink={0} />
      </Stack>
    );
  };

  return (
    <Stack
      alignItems='center'
      width='100%'
      height='100%'
      minHeight={0}
      overflow='hidden'
    >
      {getContent()}
    </Stack>
  );
};
