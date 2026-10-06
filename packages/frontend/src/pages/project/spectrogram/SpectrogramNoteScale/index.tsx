import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getFrequencyRange } from '@musetric/engine';
import { stackedLaneGap, stackedLaneRadius } from '@musetric/spectrogram';
import { subscribeResizeObserver } from '@musetric/utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { engine } from '../../../../engine/engine.js';
import {
  getNoteMarkers,
  isNaturalMidi,
  isOctaveMidi,
  type NoteMarker,
} from './noteMarker.js';

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
    const labelBackground = alpha(theme.palette.common.black, 0.8);
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
      const inkOffset =
        (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) /
        2;

      context.fillStyle = labelBackground;
      context.fillRect(x - 2, y - 6, metrics.width + 4, 12);
      context.fillStyle = color;
      context.fillText(label, x, y + inkOffset);
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

      const bandCount = notesMode ? 1 : 2;
      const bandGap = notesMode ? 0 : stackedLaneGap;
      const bandHeight = (height - bandGap * (bandCount - 1)) / bandCount;
      const markerSpacing =
        markers.length > 1 ? bandHeight / (markers.length - 1) : bandHeight;
      const withNaturalLabels = markerSpacing >= 16;

      const drawMarker = (marker: NoteMarker, y: number) => {
        const octave = isOctaveMidi(marker.midi);

        if (notesMode) {
          if (octave || (withNaturalLabels && isNaturalMidi(marker.midi))) {
            drawLabel(y, marker.label, noteLabelColor);
          }
          return;
        }

        context.strokeStyle = octave ? colors.octave : colors.semitone;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();

        if (octave) {
          drawLabel(y, marker.label, noteLabelColor);
        }
      };

      for (let band = 0; band < bandCount; band++) {
        const top = band * (bandHeight + bandGap);

        context.save();
        context.beginPath();
        context.roundRect(0, top, width, bandHeight, stackedLaneRadius);
        context.clip();
        for (const marker of markers) {
          drawMarker(
            marker,
            alignPixel(top + marker.topRatio * bandHeight, pixelRatio),
          );
        }
        context.restore();
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
