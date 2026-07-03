import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import { getSubtitlePlaybackTimeFromState } from './subtitlePlayback.js';
import { SubtitleSegmentText } from './SubtitleSegmentText.js';
import { useSubtitleSegmentStatus } from './useSubtitleSegmentStatus.js';

type TimedSubtitleElement = {
  element: HTMLElement;
  end: number;
  start: number;
};

const getTimedSubtitleElements = (element: HTMLElement) => {
  const timedElements: TimedSubtitleElement[] = [];
  const wordElements = element.querySelectorAll<HTMLElement>(
    '[data-subtitle-word-start]',
  );

  for (const wordElement of wordElements) {
    const start = Number(wordElement.dataset.subtitleWordStart);
    const end = Number(wordElement.dataset.subtitleWordEnd);
    const textElement = wordElement.querySelector<HTMLElement>(
      '[data-subtitle-word-text]',
    );

    if (textElement) {
      timedElements.push({ element: textElement, start, end });
    }

    const chordElement = wordElement.querySelector<HTMLElement>(
      '[data-subtitle-chord-start]',
    );

    if (!chordElement) {
      continue;
    }

    const chordStart = Number(chordElement.dataset.subtitleChordStart);
    const chordEnd = Number(chordElement.dataset.subtitleChordEnd);

    timedElements.push({
      element: chordElement,
      start: chordStart,
      end: chordEnd,
    });
  }

  return timedElements;
};

type TimedSubtitleColors = {
  active: string;
  inactive: string;
  past: string;
};

const getTimedSubtitleColor = (
  start: number,
  end: number,
  playbackTime: number,
  colors: TimedSubtitleColors,
) => {
  if (playbackTime >= start && playbackTime < end) {
    return colors.active;
  }

  if (playbackTime >= end) {
    return colors.past;
  }

  return colors.inactive;
};

const setElementColor = (element: HTMLElement, color: string) => {
  if (element.dataset.subtitleColor === color) {
    return;
  }

  element.dataset.subtitleColor = color;
  element.style.color = color;
};

type ActiveSubtitleSegmentProps = {
  segment: api.subtitle.Segment;
  chordSegments: api.chords.ChordSegment[];
};

const ActiveSubtitleSegment: FC<ActiveSubtitleSegmentProps> = (props) => {
  const { segment, chordSegments } = props;
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const colors: TimedSubtitleColors = {
      active: theme.palette.primary.main,
      inactive: theme.palette.text.primary,
      past: alpha(
        theme.palette.text.primary,
        theme.palette.action.disabledOpacity,
      ),
    };
    const timedElements = getTimedSubtitleElements(element);

    const update = () => {
      const playbackTime = getSubtitlePlaybackTimeFromState(engine.store.get());

      for (const timedElement of timedElements) {
        setElementColor(
          timedElement.element,
          getTimedSubtitleColor(
            timedElement.start,
            timedElement.end,
            playbackTime,
            colors,
          ),
        );
      }
    };

    update();

    return engine.store.subscribe(getSubtitlePlaybackTimeFromState, update);
  }, [chordSegments, segment, theme]);

  return (
    <Box ref={ref}>
      <SubtitleSegmentText
        segment={segment}
        status='active'
        chordSegments={chordSegments}
      />
    </Box>
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
