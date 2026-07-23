import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { createTimelineProcessor } from '@musetric/audio/timeline';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { useProjectStore } from '../store.js';
import {
  alignPixel,
  subscribeVisualizationRender,
} from './visualizationRender.js';

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
      const { visibleTime, playheadRatio } = useSettingsStore.getState();
      const { visualizationMode } = useProjectStore.getState();

      processor.updateConfig({
        mode: visualizationMode === 'tracks' ? 'tracks' : 'spectrogram',
        duration,
        frameIndex,
        frameCount,
        visibleTime,
        playheadRatio,
      });
      processor.render();

      let cursorRatio = playheadRatio;

      if (visualizationMode === 'tracks') {
        cursorRatio = frameCount ? frameIndex / frameCount : 0;
      }

      const cursorX = alignPixel(
        cursorRatio * canvasWidth,
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
      engineKeys: ['duration', 'frameCount', 'frameIndex'],
      projectKeys: ['visualizationMode'],
      settingsKeys: ['visibleTime', 'playheadRatio'],
    });

    return () => {
      unsubscribe();
      processor.dispose();
    };
  }, [theme]);

  return (
    <Box
      height='16px'
      position='relative'
      sx={{
        flexShrink: 0,
      }}
    >
      <Box
        component='canvas'
        ref={canvasRef}
        bgcolor='background.default'
        sx={{
          display: 'block',
          width: '100%',
          height: '100%',
          borderTop: 1,
          borderColor: 'grey.700',
          boxSizing: 'border-box',
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
