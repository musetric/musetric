import { alpha, Box, type Theme } from '@mui/material';
import { stackedLaneGap } from '@musetric/spectrogram';
import { type FC, useEffect, useRef } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import {
  placeTimeStrip,
  subscribeVisualizationRender,
} from '../visualization/visualizationRender.js';
import {
  findLessonPhrase,
  type LessonVerdict,
  lessonVerdictOf,
} from './lessonPhrase.js';
import {
  isWholePass,
  type LessonPlace,
  useLessonStore,
} from './lessonStore.js';

const halfGap = stackedLaneGap / 2;

const bands = [
  { top: 0, bottom: `calc(50% + ${halfGap}px)` },
  { top: `calc(50% + ${halfGap}px)`, bottom: 0 },
];

const verdictColor = (theme: Theme, verdict: LessonVerdict) =>
  ({
    differ: theme.palette.warning.main,
    clean: theme.palette.success.main,
    unsung: theme.palette.common.white,
  })[verdict];

type SpanProps = {
  start: number;
  end: number;
  duration: number;
};

const spanStyle = (props: SpanProps) => ({
  left: `${(props.start / props.duration) * 100}%`,
  width: `${((props.end - props.start) / props.duration) * 100}%`,
});

type PlaceHighlightProps = {
  place: LessonPlace;
  duration: number;
  outline: boolean;
};

const PlaceHighlight: FC<PlaceHighlightProps> = (props) => {
  const { place, duration, outline } = props;
  const phrase = useEngineStore((state) =>
    findLessonPhrase(state.vocalLessonPhrases, place),
  );
  const verdict = lessonVerdictOf(phrase);
  const focusStart = phrase?.difference?.focusStart ?? place.focusStart;
  const focusEnd = phrase?.difference?.focusEnd ?? place.focusEnd;

  return bands.map((band) => (
    <Box key={String(band.top)}>
      {outline && (
        <Box
          style={{
            ...spanStyle({ start: place.start, end: place.end, duration }),
            top: band.top,
            bottom: band.bottom,
          }}
          sx={(theme) => ({
            position: 'absolute',
            borderLeft: `1px dashed ${alpha(theme.palette.common.white, 0.5)}`,
            borderRight: `1px dashed ${alpha(theme.palette.common.white, 0.5)}`,
          })}
        />
      )}
      <Box
        style={{
          ...spanStyle({ start: focusStart, end: focusEnd, duration }),
          top: band.top,
          bottom: band.bottom,
        }}
        sx={(theme) => {
          const color = verdictColor(theme, verdict);
          return {
            position: 'absolute',
            borderLeft: `2px solid ${color}`,
            borderRight: `2px solid ${color}`,
            backgroundColor: alpha(color, 0.12),
          };
        }}
      />
    </Box>
  ));
};

export const LessonHighlight: FC = () => {
  const duration = useEngineStore((state) => state.duration);
  const places = useLessonStore((state) => state.places);
  const index = useLessonStore((state) => state.index);
  const whole = useLessonStore(isWholePass);
  const singing = useLessonStore((state) => state.activity === 'singing');
  const areaRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const shown = whole ? places : places.slice(index, index + 1);

  useEffect(() => {
    const area = areaRef.current;
    const strip = stripRef.current;
    if (!area || !strip) {
      return;
    }
    const view = { width: area.getBoundingClientRect().width, stripWidth: -1 };
    const render = () => {
      placeTimeStrip(strip, view);
    };
    const resize = () => {
      view.width = area.getBoundingClientRect().width;
      render();
    };
    render();
    return subscribeVisualizationRender({
      resizeTarget: area,
      onResize: resize,
      render,
      engineKeys: ['duration', 'frameCount', 'frameIndex', 'viewWindow'],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });
  }, []);

  return (
    <Box
      ref={areaRef}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <Box
        ref={stripRef}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          willChange: 'transform',
        }}
      >
        {duration > 0 &&
          !singing &&
          shown.map((place) => (
            <PlaceHighlight
              key={place.start}
              place={place}
              duration={duration}
              outline={!whole}
            />
          ))}
      </Box>
    </Box>
  );
};
