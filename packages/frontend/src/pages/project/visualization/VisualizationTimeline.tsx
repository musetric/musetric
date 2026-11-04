import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { createTimelineProcessor } from '@musetric/audio/timeline';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from './visualizationRender.js';
import { getVisualizationView } from './visualizationView.js';

export const VisualizationTimeline: FC = () => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const handle = handleRef.current;

    if (!canvas || !handle) {
      return;
    }

    const processor = createTimelineProcessor({
      config: {
        canvas,
        markerColor: theme.palette.default.main,
        labelColor: theme.palette.default.main,
        font: `11px ${theme.typography.fontFamily}`,
      },
    });
    let canvasWidth = canvas.getBoundingClientRect().width;

    const render = () => {
      const { duration, frameIndex, frameCount } = engine.store.get();
      const { visibleTime, playheadRatio } = getVisualizationView();

      processor.updateConfig({
        duration,
        frameIndex,
        frameCount,
        visibleTime,
        playheadRatio,
      });
      processor.render();

      const cursorX = alignPixel(
        playheadRatio * canvasWidth,
        window.devicePixelRatio,
      );

      handle.style.transform = `translateX(${cursorX + 0.5}px) translateX(-50%)`;
    };

    const resize = () => {
      canvasWidth = canvas.getBoundingClientRect().width;
      render();
    };

    render();

    const unsubscribe = subscribeVisualizationRender({
      resizeTarget: canvas,
      onResize: resize,
      render,
      engineKeys: ['duration', 'frameCount', 'frameIndex', 'viewWindow'],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });

    return () => {
      unsubscribe();
      processor.dispose();
    };
  }, [theme]);

  return (
    <Box sx={{ height: '16px', position: 'relative', flexShrink: 0 }}>
      <Box
        component='canvas'
        ref={canvasRef}
        sx={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />
      <Box
        ref={handleRef}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: 'primary.main',
          pointerEvents: 'none',
          willChange: 'transform',
          zIndex: 1,
        }}
      />
    </Box>
  );
};
