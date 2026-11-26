import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type api } from '@musetric/api';
import { type FC, type RefObject, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { subscribeEnginePosition } from '../../../engine/enginePosition.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type SubtitleCursor } from './subtitleCursor.js';
import { SubtitleLoopBand } from './SubtitleLoopBand.js';
import {
  getSubtitleLoopWordsKey,
  parseSubtitleLoopWordsKey,
} from './subtitleLoopBands.js';
import { getSubtitlePlaybackTime } from './subtitlePlayback.js';
import { SubtitleSegmentText } from './SubtitleSegmentText.js';

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

const clearElementColor = (element: HTMLElement) => {
  delete element.dataset.subtitleColor;
  element.style.color = '';
};

const useSubtitleSegmentStatus = (
  ref: RefObject<HTMLElement | null>,
  index: number,
  segment: api.subtitle.Segment,
  subtitleCursor: SubtitleCursor,
) => {
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
      const playbackTime = getSubtitlePlaybackTime(
        engine.position.read(),
        engine.store.get(),
      );

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

    let unsubscribeColors: (() => void) | undefined = undefined;

    const stopColors = () => {
      unsubscribeColors?.();
      unsubscribeColors = undefined;
      for (const timedElement of timedElements) {
        clearElementColor(timedElement.element);
      }
    };

    const applyStatus = () => {
      const status = subtitleCursor.getSegmentStatus(index);
      if (element.dataset.subtitleSegmentStatus !== status) {
        element.dataset.subtitleSegmentStatus = status;
      }
      if (status !== 'active') {
        if (unsubscribeColors) {
          stopColors();
        }
        return;
      }
      if (!unsubscribeColors) {
        update();
        unsubscribeColors = subscribeEnginePosition(
          getSubtitlePlaybackTime,
          update,
        );
      }
    };

    applyStatus();

    const unsubscribeStatus = subtitleCursor.subscribeSegmentStatus(
      index,
      applyStatus,
    );

    return () => {
      unsubscribeStatus();
      if (unsubscribeColors) {
        stopColors();
      }
    };
  }, [ref, index, segment, subtitleCursor, theme]);
};

export type SubtitleSegmentProps = {
  index: number;
  segment: api.subtitle.Segment;
  subtitleCursor: SubtitleCursor;
};

export const SubtitleSegment: FC<SubtitleSegmentProps> = (props) => {
  const { index, segment, subtitleCursor } = props;
  const loopedKey = useEngineStore((state) =>
    getSubtitleLoopWordsKey(segment, state, engine.context.sampleRate),
  );
  const loopedWords = parseSubtitleLoopWordsKey(loopedKey);
  const ref = useRef<HTMLDivElement>(null);
  useSubtitleSegmentStatus(ref, index, segment, subtitleCursor);

  return (
    <Box
      ref={ref}
      data-subtitle-segment-index={index}
      data-subtitle-segment-status={subtitleCursor.getSegmentStatus(index)}
      sx={(theme) => ({
        py: 1,
        px: 4,
        '@media (any-pointer: coarse)': { pl: 8, pr: 6 },
        alignSelf: 'stretch',
        display: 'flex',
        justifyContent: 'center',
        position: 'relative',
        isolation: 'isolate',
        bgcolor:
          loopedKey === 'all'
            ? alpha(theme.palette.primary.main, 0.14)
            : undefined,
      })}
    >
      {loopedWords && <SubtitleLoopBand words={loopedWords} />}
      <SubtitleSegmentText segment={segment} />
    </Box>
  );
};
