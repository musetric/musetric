import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getFrequencyRange } from '@musetric/engine';
import { subscribeResizeObserver } from '@musetric/utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../../engine/engine.js';
import { getNoteMarkers, isNaturalMidi, isOctaveMidi } from './noteMarker.js';

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
      octave: alpha(theme.palette.common.white, 0.22),
      semitone: alpha(theme.palette.common.white, 0.06),
    };
    const noteLabelColor = alpha(theme.palette.text.primary, 0.55);
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

    const drawLabel = (y: number, label: string, color: string) => {
      const x = 6;
      const metrics = context.measureText(label);

      context.fillStyle = labelBackground;
      context.fillRect(x - 2, y - 6, metrics.width + 4, 12);
      context.fillStyle = color;
      context.fillText(label, x, y);
    };

    const render = () => {
      const state = engine.store.get();
      const { minFrequency, maxFrequency } = getFrequencyRange(state);
      const notesMode = state.spectrogramView === 'notes';
      const markers = getNoteMarkers(minFrequency, maxFrequency);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      context.font = font;
      context.textBaseline = 'middle';
      context.lineWidth = 1;

      const markerSpacing =
        markers.length > 1 ? height / (markers.length - 1) : height;
      const withNaturalLabels = markerSpacing >= 16;

      for (const marker of markers) {
        const y = alignPixel(marker.topRatio * height, pixelRatio);
        const octave = isOctaveMidi(marker.midi);

        if (notesMode) {
          if (octave || (withNaturalLabels && isNaturalMidi(marker.midi))) {
            drawLabel(y, marker.label, noteLabelColor);
          }
          continue;
        }

        context.strokeStyle = octave ? colors.octave : colors.semitone;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();

        if (octave) {
          drawLabel(y, marker.label, noteLabelColor);
        }
      }

      context.restore();
    };

    const resizeAndRender = () => {
      resize();
      render();
    };

    resizeAndRender();

    const unsubscribeResize = subscribeResizeObserver(canvas, resizeAndRender);
    const unsubscribeView = engine.store.subscribe((state) => {
      const range = getFrequencyRange(state);
      return `${state.spectrogramView}:${range.minFrequency}:${range.maxFrequency}`;
    }, render);

    return () => {
      unsubscribeResize();
      unsubscribeView();
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
