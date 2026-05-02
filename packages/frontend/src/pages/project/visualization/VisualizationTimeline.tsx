import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { createTimelineProcessor } from '@musetric/audio/timeline';
import { subscribeResizeObserver } from '@musetric/resource-utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';

export const timelineHeight = 32;

const engineRenderKeys = ['duration', 'frameCount', 'frameIndex'] as const;
const projectRenderKeys = ['visualizationMode'] as const;
const settingsRenderKeys = ['visibleTime', 'playheadRatio'] as const;

export const VisualizationTimeline: FC = () => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const { fontSize } = theme.typography.caption;
    const processor = createTimelineProcessor({
      config: {
        canvas,
        markerColor: theme.palette.grey[500],
        labelColor: theme.palette.grey[400],
        font: `${fontSize} ${theme.typography.fontFamily}`,
      },
    });
    const render = () => {
      const { duration, frameIndex, frameCount } = engine.store.get();
      const { visibleTime, playheadRatio } = useSettingsStore.getState();

      processor.updateConfig({
        mode: useProjectStore.getState().visualizationMode,
        duration,
        frameIndex,
        frameCount,
        visibleTime,
        playheadRatio,
      });
      processor.render();
    };

    render();

    const unsubscribes = [
      subscribeResizeObserver(canvas, render),
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
      processor.dispose();
    };
  }, [theme]);

  return (
    <Box
      position='absolute'
      left={0}
      right={0}
      bottom={0}
      height={timelineHeight}
      bgcolor='background.default'
    >
      <canvas
        ref={canvasRef}
        height={timelineHeight}
        style={{
          display: 'block',
          width: '100%',
          height: timelineHeight,
          flexShrink: 0,
          borderTop: `1px solid ${theme.palette.divider}`,
          boxSizing: 'border-box',
        }}
      />
    </Box>
  );
};
