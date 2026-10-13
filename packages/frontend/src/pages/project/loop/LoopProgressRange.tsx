import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const edgeSx = {
  position: 'absolute',
  top: -3,
  width: 4,
  height: 19,
  borderRadius: 0.5,
  transform: 'translateX(-50%)',
  bgcolor: 'primary.main',
} as const;

export const LoopProgressRange: FC = () => {
  const range = useEngineStore((state) =>
    state.loopStage === undefined ? undefined : state.range,
  );
  const frameCount = useEngineStore((state) => state.frameCount);

  if (!range || !frameCount) {
    return undefined;
  }

  const percent = (frame: number) => `${(frame / frameCount) * 100}%`;

  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: 13,
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={(theme) => ({
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: percent(range.fromFrame),
          width: percent(range.toFrame - range.fromFrame),
          borderRadius: 0.75,
          bgcolor: alpha(theme.palette.primary.main, 0.3),
        })}
      />
      <Box sx={{ ...edgeSx, left: percent(range.fromFrame) }} />
      <Box sx={{ ...edgeSx, left: percent(range.toFrame) }} />
    </Box>
  );
};
