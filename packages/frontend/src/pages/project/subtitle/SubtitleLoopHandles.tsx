import { Box } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useLayoutEffect, useMemo, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type LoopEdge, type SubtitleWordRef } from '../loop/loopRange.js';
import { getSubtitleLoopEdges, wordInset } from './subtitleLoopBands.js';
import { findSubtitleWordElement } from './subtitleWordHit.js';

const knobSize = 12;
const knobOverhang = 8;
const knobInward = 10;
const hitWidth = 40;
const hitOverhang = 20;
const screenEdgeMargin = 32;
const shiftProperty = '--subtitle-loop-handle-shift';

type SubtitleLoopHandleProps = {
  edge: LoopEdge;
  word: SubtitleWordRef;
};

const SubtitleLoopHandle: FC<SubtitleLoopHandleProps> = (props) => {
  const { edge, word } = props;
  const { segmentIndex, wordIndex } = word;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    const list = root?.parentElement;
    if (!root || !list) {
      return;
    }

    const place = () => {
      const target = findSubtitleWordElement(list, {
        segmentIndex,
        wordIndex,
      });
      if (!target) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const x =
        edge === 'from' ? rect.left - wordInset : rect.right + wordInset;
      const shift =
        edge === 'from'
          ? Math.max(0, screenEdgeMargin - x)
          : Math.min(0, window.innerWidth - screenEdgeMargin - x);
      root.style.setProperty(shiftProperty, `${shift}px`);
      root.style.height = `${rect.height}px`;
      root.style.transform = `translate(${x - listRect.left + list.scrollLeft}px, ${rect.top - listRect.top + list.scrollTop}px)`;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [edge, segmentIndex, wordIndex]);

  const outer = edge === 'from' ? 'top' : 'bottom';
  const inner = edge === 'from' ? 'bottom' : 'top';
  const inward = edge === 'from' ? 1 : -1;

  return (
    <Box ref={ref} sx={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }}>
      <Box
        sx={{
          position: 'absolute',
          left: -1,
          top: 0,
          bottom: 0,
          width: 2,
          bgcolor: 'primary.main',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: `calc(var(${shiftProperty}) + ${inward * knobInward - knobSize / 2}px)`,
          [outer]: -knobOverhang,
          width: knobSize,
          height: knobSize,
          borderRadius: '50%',
          bgcolor: 'primary.main',
        }}
      />
      <Box
        data-subtitle-loop-edge={edge}
        sx={{
          position: 'absolute',
          left: `calc(var(${shiftProperty}) + ${edge === 'from' ? 0 : -hitWidth}px)`,
          width: hitWidth,
          [outer]: -hitOverhang,
          [inner]: 0,
          cursor: 'ew-resize',
          touchAction: 'none',
        }}
      />
    </Box>
  );
};

export type SubtitleLoopHandlesProps = {
  subtitle: api.subtitle.Segment[];
};

export const SubtitleLoopHandles: FC<SubtitleLoopHandlesProps> = (props) => {
  const { subtitle } = props;
  const editable = useEngineStore((state) => state.loopStage === 'range');
  const range = useEngineStore((state) => state.range);
  const edges = useMemo(
    () =>
      range
        ? getSubtitleLoopEdges(subtitle, range, engine.context.sampleRate)
        : undefined,
    [subtitle, range],
  );

  if (!editable || !edges) {
    return undefined;
  }

  return (
    <>
      <SubtitleLoopHandle edge='from' word={edges.first} />
      <SubtitleLoopHandle edge='to' word={edges.last} />
    </>
  );
};
