import { Box } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { viewSizePresets } from '../constants.js';
import { attachCanvas, detachCanvas } from '../processor.js';
import { useProcessingStore } from '../store.js';

export const BenchmarkCanvas: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<OffscreenCanvas | null>(null);

  useEffect(() => {
    if (!offscreenRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas element not found');
      }
      // Set initial dimensions before transfer; later resizes are handled
      // inside the processor via setOffscreenCanvasSize on each render.
      const preset =
        viewSizePresets[useProcessingStore.getState().params.viewSizeKey];
      canvas.width = preset.width;
      canvas.height = preset.height;
      offscreenRef.current = canvas.transferControlToOffscreen();
    }
    attachCanvas(offscreenRef.current);

    return () => {
      detachCanvas();
    };
  }, []);

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <canvas ref={canvasRef} />
    </Box>
  );
};
