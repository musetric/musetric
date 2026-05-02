import { alpha, Box } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';
import { timelineHeight } from './VisualizationTimeline.js';

const cursorWidth = 2;
const cursorHandleSize = 9;
const engineRenderKeys = ['frameCount', 'frameIndex'] as const;
const projectRenderKeys = ['visualizationMode'] as const;
const settingsRenderKeys = ['playheadRatio'] as const;

export const VisualizationCursor: FC = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const render = () => {
      const { frameCount, frameIndex } = engine.store.get();
      const { playheadRatio } = useSettingsStore.getState();
      const waveformCursorRatio = frameCount ? frameIndex / frameCount : 0;
      const cursorRatio =
        useProjectStore.getState().visualizationMode === 'spectrogram'
          ? playheadRatio
          : waveformCursorRatio;

      element.style.left = `${cursorRatio * 100}%`;
    };

    render();

    const unsubscribes = [
      ...engineRenderKeys.map((key) =>
        engine.store.subscribe((state) => state[key], render),
      ),
      ...projectRenderKeys.map((key) =>
        useProjectStore.subscribe((state) => state[key], render),
      ),
      ...settingsRenderKeys.map((key) =>
        useSettingsStore.subscribe((state) => state[key], render),
      ),
    ];

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, []);

  return (
    <Box
      ref={ref}
      position='absolute'
      top={0}
      bottom={timelineHeight}
      left={0}
      width={cursorWidth}
      sx={{
        backgroundColor: (theme) => alpha(theme.palette.default.main, 0.9),
        boxShadow: (theme) =>
          `0 0 8px ${alpha(theme.palette.common.black, 0.45)}`,
        pointerEvents: 'none',
        transform: `translateX(-${cursorWidth / 2}px)`,
        willChange: 'transform',
        zIndex: 2,
      }}
    >
      <Box
        position='absolute'
        left='50%'
        bottom={-cursorHandleSize}
        width={cursorHandleSize}
        height={cursorHandleSize}
        borderRadius='50%'
        sx={{
          backgroundColor: (theme) => alpha(theme.palette.default.main, 0.95),
          boxShadow: (theme) =>
            `0 0 8px ${alpha(theme.palette.common.black, 0.45)}`,
          transform: 'translateX(-50%)',
        }}
      />
    </Box>
  );
};
