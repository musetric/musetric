import { Box } from '@mui/material';
import { assertDefined } from '@musetric/utils';
import { type FC, useEffect, useRef } from 'react';
import { viewSizePresets } from '../constants.js';
import { type BenchmarkProcessor } from '../processor.js';
import { useProcessingStore } from '../store.js';

type BenchmarkCanvasProps = {
  processor: BenchmarkProcessor;
};

export const BenchmarkCanvas: FC<BenchmarkCanvasProps> = (props) => {
  const { processor } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<OffscreenCanvas | null>(null);

  useEffect(() => {
    if (!offscreenRef.current) {
      const canvas = assertDefined(
        canvasRef.current,
        'Canvas element not found',
      );
      const preset =
        viewSizePresets[useProcessingStore.getState().params.viewSizeKey];
      canvas.width = preset.width;
      canvas.height = preset.height;
      offscreenRef.current = canvas.transferControlToOffscreen();
    }
    processor.attachCanvas(offscreenRef.current);

    return () => {
      processor.detachCanvas();
    };
  }, [processor]);

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
