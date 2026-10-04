import { alpha, Box, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { getTrackProgress } from '@musetric/engine';
import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useMemo, useRef } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useSettingsStore } from '../settings/store.js';
import { VisualizationCursor } from '../visualization/VisualizationCursor.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from '../visualization/visualizationRender.js';
import { findChordBlockIndex, getChordBlocks } from './chordBlocks.js';

export const chordLaneHeight = 28;
export const chordBlockInset = 3;

const emptySegments: api.chords.ChordSegment[] = [];

export const ChordLane: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const chordsQuery = useQuery(endpoints.chords.get(projectId));
  const segments = chordsQuery.data?.segments ?? emptySegments;
  const duration = useEngineStore((state) => state.duration);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const blocks = useMemo(
    () => (duration > 0 ? getChordBlocks(segments, transposeSemitones) : []),
    [duration, segments, transposeSemitones],
  );
  const laneRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lane = laneRef.current;
    const strip = stripRef.current;

    if (!lane || !strip) {
      return;
    }

    const labels = Array.from(
      strip.querySelectorAll<HTMLElement>('[data-chord-label]'),
    );
    const view = {
      laneWidth: lane.getBoundingClientRect().width,
      stripWidth: -1,
      pinned: -1,
    };

    const render = () => {
      const state = engine.store.get();
      const { visibleTime, playheadRatio } = useSettingsStore.getState();
      const pixelsPerSecond = view.laneWidth / visibleTime;
      const stripWidth = state.duration * pixelsPerSecond;

      if (stripWidth !== view.stripWidth) {
        view.stripWidth = stripWidth;
        strip.style.width = `${stripWidth}px`;
      }

      const time = state.duration * getTrackProgress(state);
      const start = time - visibleTime * playheadRatio;
      const stripX = alignPixel(
        -start * pixelsPerSecond,
        window.devicePixelRatio,
      );
      strip.style.transform = `translateX(${stripX}px)`;

      const index = findChordBlockIndex(blocks, start);

      if (index !== view.pinned && view.pinned >= 0) {
        labels[view.pinned].style.transform = '';
      }
      view.pinned = index;

      if (index >= 0) {
        const offset = -stripX - blocks[index].start * pixelsPerSecond;
        labels[index].style.transform = `translateX(${offset}px)`;
      }
    };

    const resize = () => {
      view.laneWidth = lane.getBoundingClientRect().width;
      render();
    };

    render();

    const unsubscribe = subscribeVisualizationRender({
      resizeTarget: lane,
      onResize: resize,
      render,
      engineKeys: ['duration', 'frameCount', 'frameIndex'],
      projectKeys: [],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });

    return () => {
      unsubscribe();
      if (view.pinned >= 0) {
        labels[view.pinned].style.transform = '';
      }
    };
  }, [blocks]);

  return (
    <Box
      ref={laneRef}
      position='relative'
      height={`${chordLaneHeight}px`}
      overflow='hidden'
      sx={{
        flexShrink: 0,
        boxSizing: 'content-box',
        borderBottom: 1,
        borderColor: 'grey.700',
        userSelect: 'none',
      }}
    >
      <Box
        ref={stripRef}
        aria-hidden
        position='absolute'
        top={0}
        bottom={0}
        left={0}
        sx={{ willChange: 'transform' }}
      >
        {blocks.map((block) => (
          <Box
            key={block.start}
            position='absolute'
            top={`${chordBlockInset}px`}
            bottom={`${chordBlockInset}px`}
            display='flex'
            alignItems='center'
            overflow='hidden'
            style={{
              left: `${(block.start / duration) * 100}%`,
              width: `${((block.end - block.start) / duration) * 100}%`,
            }}
            sx={(theme) => ({
              boxSizing: 'border-box',
              borderLeft: `1px solid ${theme.palette.default.main}`,
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
            })}
          >
            <Typography
              data-chord-label=''
              variant='caption'
              fontWeight={600}
              lineHeight={1}
              noWrap
              px={1}
            >
              {block.label}
            </Typography>
          </Box>
        ))}
      </Box>
      <VisualizationCursor />
    </Box>
  );
};
