import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { subscribeResizeObserver } from '@musetric/resource-utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../settings/store.js';
import { getNoteMarkers } from './noteMarker.js';

const alignPixel = (value: number, pixelRatio: number) =>
  Math.round(value * pixelRatio) / pixelRatio;

export const SpectrogramNoteScale: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const colors = {
      primary: alpha(theme.palette.primary.main, 0.9),
      secondary: alpha(theme.palette.secondary.main, 0.55),
      gray: alpha(theme.palette.grey[400], 0.2),
    };
    const labelBackground = alpha(theme.palette.background.default, 0.6);
    const font = `12px ${theme.typography.fontFamily}`;
    let pixelRatio = window.devicePixelRatio || 1;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;

      const canvasWidth = Math.max(1, Math.round(width * pixelRatio));
      const canvasHeight = Math.max(1, Math.round(height * pixelRatio));

      if (canvas.width !== canvasWidth) {
        canvas.width = canvasWidth;
      }
      if (canvas.height !== canvasHeight) {
        canvas.height = canvasHeight;
      }
    };

    const render = () => {
      const { minFrequency, maxFrequency } = useSettingsStore.getState();
      const markers = getNoteMarkers(minFrequency, maxFrequency);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      context.font = font;
      context.textBaseline = 'middle';
      context.lineWidth = 1;

      for (const marker of markers) {
        const color = colors[marker.tone];
        const y = alignPixel(marker.topRatio * height, pixelRatio);

        context.strokeStyle = color;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();

        if (marker.tone === 'gray') {
          continue;
        }

        const x = 6;
        const metrics = context.measureText(marker.label);

        context.fillStyle = labelBackground;
        context.fillRect(x - 2, y - 6, metrics.width + 4, 12);
        context.fillStyle = color;
        context.fillText(marker.label, x, y);
      }

      context.restore();
    };

    const resizeAndRender = () => {
      resize();
      render();
    };

    resizeAndRender();

    const unsubscribeResize = subscribeResizeObserver(canvas, resizeAndRender);
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => `${state.minFrequency}:${state.maxFrequency}`,
      render,
    );

    return () => {
      unsubscribeResize();
      unsubscribeSettings();
    };
  }, [theme]);

  return (
    <Box
      component='canvas'
      ref={canvasRef}
      position='absolute'
      top={0}
      right={0}
      bottom={0}
      left={0}
      sx={{
        display: 'block',
        height: '100%',
        pointerEvents: 'none',
        width: '100%',
      }}
    />
  );
};
