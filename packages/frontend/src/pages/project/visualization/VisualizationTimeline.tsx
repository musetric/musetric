import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { createTimelineProcessor } from '@musetric/audio/timeline';
import {
  createCanvasCache,
  defaultCacheConfig,
  subscribeResizeObserver,
} from '@musetric/resource-utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';

const alignPixel = (value: number, pixelRatio: number) =>
  Math.round(value * pixelRatio) / pixelRatio;

export const VisualizationTimeline: FC = () => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const handle = handleRef.current;

    if (!container || !canvas || !handle) {
      return;
    }

    const engineRenderKeys = ['duration', 'frameCount', 'frameIndex'] as const;
    const projectRenderKeys = ['visualizationMode'] as const;
    const settingsRenderKeys = ['visibleTime', 'playheadRatio'] as const;

    const cache = createCanvasCache(defaultCacheConfig);

    const processor = createTimelineProcessor({
      config: {
        canvas,
        markerColor: theme.palette.default.main,
        labelColor: theme.palette.default.main,
        font: `11px ${theme.typography.fontFamily}`,
        paddingLeftFactor: defaultCacheConfig.paddingLeftFactor,
        paddingRightFactor: defaultCacheConfig.paddingRightFactor,
      },
    });

    let needsRender = true;

    const getCursorRatio = () => {
      const { playheadRatio } = useSettingsStore.getState();
      const { frameIndex, frameCount } = engine.store.get();
      const { visualizationMode } = useProjectStore.getState();

      if (visualizationMode === 'tracks') {
        return frameCount ? frameIndex / frameCount : 0;
      }
      return playheadRatio;
    };

    const render = () => {
      const { duration, frameIndex, frameCount } = engine.store.get();
      const { visibleTime, playheadRatio } = useSettingsStore.getState();
      const { visualizationMode } = useProjectStore.getState();

      processor.updateConfig({
        mode: visualizationMode,
        duration,
        frameIndex,
        frameCount,
        visibleTime,
        playheadRatio,
      });
      processor.render();
    };

    const updateHandle = () => {
      const cursorRatio = getCursorRatio();
      const { width } = container.getBoundingClientRect();
      const cursorX = alignPixel(cursorRatio * width, window.devicePixelRatio);
      handle.style.transform = `translateX(${cursorX + 0.5}px) translateX(-50%)`;
    };

    const update = () => {
      const cursorRatio = getCursorRatio();

      if (cache.shouldRender(cursorRatio)) {
        needsRender = true;
      }

      if (needsRender) {
        render();
        cache.updateCache(cursorRatio);
        needsRender = false;
      }

      cache.updateTransform(cursorRatio, container, canvas);
      updateHandle();
    };

    update();

    const unsubscribes = [
      subscribeResizeObserver(container, () => {
        cache.invalidate();
        needsRender = true;
        update();
      }),
      ...engineRenderKeys.map((key) =>
        engine.store.subscribe((state) => state[key], update),
      ),
      ...projectRenderKeys.map((key) =>
        useProjectStore.subscribe((state) => state[key], update),
      ),
      ...settingsRenderKeys.map((key) =>
        useSettingsStore.subscribe((state) => state[key], update),
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
      ref={containerRef}
      height='16px'
      position='relative'
      sx={{
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        component='canvas'
        ref={canvasRef}
        bgcolor='background.default'
        sx={{
          display: 'block',
          width: '150%',
          height: '100%',
          borderTop: 1,
          borderColor: 'grey.700',
          boxSizing: 'border-box',
          willChange: 'transform',
        }}
      />
      <Box
        ref={handleRef}
        position='absolute'
        top={0}
        left={0}
        width='7px'
        height='7px'
        borderRadius='50%'
        sx={{
          backgroundColor: 'primary.main',
          pointerEvents: 'none',
          willChange: 'transform',
          zIndex: 1,
        }}
      />
    </Box>
  );
};
