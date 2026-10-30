import { alpha, Box, Typography } from '@mui/material';
import { stackedLaneGap, type VocalMark } from '@musetric/spectrogram';
import { subscribeResizeObserver } from '@musetric/utils/dom';
import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useSettingsStore } from '../settings/store.js';
import {
  placeTimeStrip,
  subscribeVisualizationRender,
} from '../visualization/visualizationRender.js';
import {
  findPlace,
  practicePlaces,
  usePracticeStore,
} from './practiceStore.js';
import { createVocalListener } from './vocalListen.js';
import { VocalMarkCard } from './VocalMarkCard.js';
import { describeVocalMark, vocalKindLabel } from './vocalMarkText.js';

const chipHeight = 18;
const chipInset = 4;
const traitInset = 24;
const rowGap = 2;
const maxRows = 4;
const chipCharacterPixels = 7;
const chipPaddingPixels = 24;

const halfGap = stackedLaneGap / 2;

const vocalMarkKey = (mark: VocalMark) => `${mark.kind}:${mark.start}`;

type ChipRows = Map<string, number>;

const packRows = (
  marks: readonly VocalMark[],
  labelOf: (mark: VocalMark) => string,
  secondsPerPixel: number,
): ChipRows => {
  const rows: ChipRows = new Map();
  const ends = new Map<boolean, number[]>([
    [true, []],
    [false, []],
  ]);
  for (const mark of marks.toSorted(
    (left, right) => left.start - right.start,
  )) {
    const bandEnds = ends.get(mark.status === 'trait') ?? [];
    const width =
      (labelOf(mark).length * chipCharacterPixels + chipPaddingPixels) *
      secondsPerPixel;
    let row = bandEnds.findIndex((end) => end <= mark.start);
    if (row < 0) {
      row =
        bandEnds.length < maxRows
          ? bandEnds.length
          : bandEnds.indexOf(Math.min(...bandEnds));
    }
    bandEnds[row] = mark.start + width;
    rows.set(vocalMarkKey(mark), row);
  }
  return rows;
};

const chipVertical = (mark: VocalMark, row: number) => {
  const offset = row * (chipHeight + rowGap);
  return mark.status === 'trait'
    ? { top: `calc(50% + ${halfGap + traitInset + offset}px)` }
    : { bottom: `calc(50% + ${halfGap + chipInset + offset}px)` };
};

type VocalMarkChipProps = {
  mark: VocalMark;
  row: number;
  duration: number;
  onOpen: (anchor: HTMLElement) => void;
};

const VocalMarkChip: FC<VocalMarkChipProps> = (props) => {
  const { mark, row, duration, onOpen } = props;
  const { t } = useTranslation();
  const text = describeVocalMark(t, mark);
  const chipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const chip = chipRef.current;
    if (!chip) {
      return;
    }
    const keepFromGesture = (event: PointerEvent) => {
      event.stopPropagation();
    };
    chip.addEventListener('pointerdown', keepFromGesture);
    return () => {
      chip.removeEventListener('pointerdown', keepFromGesture);
    };
  }, []);

  return (
    <Box
      ref={chipRef}
      component='button'
      type='button'
      style={{
        left: `${(mark.start / duration) * 100}%`,
        ...chipVertical(mark, row),
      }}
      sx={[
        {
          position: 'absolute',
          height: chipHeight,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          border: 0,
          borderRadius: chipHeight / 2,
        },
        (theme) => {
          const color = {
            differ: theme.palette.warning.main,
            match: theme.palette.success.main,
            trait: theme.palette.text.secondary,
          }[mark.status];
          return {
            cursor: 'pointer',
            pointerEvents: 'auto',
            color,
            backgroundColor: alpha(theme.palette.common.black, 0.75),
            outline: `1px solid ${alpha(color, 0.6)}`,
            whiteSpace: 'nowrap',
            '&:hover': { backgroundColor: theme.palette.common.black },
          };
        },
      ]}
      onClick={(event) => {
        onOpen(event.currentTarget);
      }}
    >
      <Typography variant='caption' sx={{ fontWeight: 600, lineHeight: 1 }}>
        {mark.status === 'match' ? `✓ ${text.label}` : text.label}
      </Typography>
    </Box>
  );
};

type SpanHighlightProps = {
  mark: VocalMark;
  duration: number;
};

const SpanHighlight: FC<SpanHighlightProps> = (props) => {
  const { mark, duration } = props;
  const left = `${(mark.start / duration) * 100}%`;
  const width = `${((mark.end - mark.start) / duration) * 100}%`;
  const bands = [
    { top: 0, bottom: `calc(50% + ${halfGap}px)` },
    { top: `calc(50% + ${halfGap}px)`, bottom: 0 },
  ];

  return bands.map((band) => (
    <Box
      key={String(band.top)}
      style={{ left, width, top: band.top, bottom: band.bottom }}
      sx={(theme) => ({
        position: 'absolute',
        borderLeft: `1px solid ${alpha(theme.palette.common.white, 0.7)}`,
        borderRight: `1px solid ${alpha(theme.palette.common.white, 0.7)}`,
        backgroundColor: alpha(theme.palette.common.white, 0.08),
      })}
    />
  ));
};

export const VocalMarks: FC = () => {
  const { t } = useTranslation();
  const marks = useEngineStore((state) => state.vocalMarks);
  const visibleTime = useSettingsStore((state) => state.visibleTime);
  const [areaWidth, setAreaWidth] = useState(0);
  const duration = useEngineStore((state) => state.duration);
  const kinds = useSettingsStore((state) => state.vocalCoach);
  const practiceKind = usePracticeStore((state) => state.kind);
  const practiceTime = usePracticeStore((state) => state.time);
  const shown = useMemo(
    () =>
      marks.filter((mark) =>
        practiceKind ? mark.kind === practiceKind : kinds[mark.kind],
      ),
    [marks, kinds, practiceKind],
  );
  const practicePlace = practiceKind
    ? findPlace(practicePlaces(marks, practiceKind), practiceTime)
    : undefined;
  const [selected, setSelected] = useState<{
    key: string;
    anchor: HTMLElement;
  }>();
  const selectedMark = selected
    ? shown.find((mark) => vocalMarkKey(mark) === selected.key)
    : undefined;
  const selection =
    selected && selectedMark
      ? { mark: selectedMark, anchor: selected.anchor }
      : undefined;
  const [listener] = useState(createVocalListener);
  const rows = useMemo(
    () =>
      packRows(
        shown,
        (mark) => vocalKindLabel(t, mark.kind),
        visibleTime / Math.max(1, areaWidth),
      ),
    [shown, t, visibleTime, areaWidth],
  );
  const areaRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

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
      engineKeys: ['duration', 'frameCount', 'frameIndex'],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });
  }, []);

  useEffect(() => listener.dispose, [listener]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    return subscribeResizeObserver(area, () => {
      setAreaWidth(area.getBoundingClientRect().width);
    });
  }, []);

  return (
    <Box
      ref={areaRef}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
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
        {duration > 0 && selection && (
          <SpanHighlight mark={selection.mark} duration={duration} />
        )}
        {duration > 0 && practicePlace && !selection && (
          <SpanHighlight mark={practicePlace} duration={duration} />
        )}
        {duration > 0 &&
          shown.map((mark) => (
            <VocalMarkChip
              key={vocalMarkKey(mark)}
              mark={mark}
              row={rows.get(vocalMarkKey(mark)) ?? 0}
              duration={duration}
              onOpen={(anchor) => {
                setSelected({ key: vocalMarkKey(mark), anchor });
              }}
            />
          ))}
      </Box>
      <VocalMarkCard
        selection={selection}
        listener={listener}
        onClose={() => {
          setSelected(undefined);
        }}
      />
    </Box>
  );
};
