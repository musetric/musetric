import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { type FC } from 'react';

const ringLength = 132;

const fill = keyframes`
  to {
    stroke-dashoffset: 0;
  }
`;

export type HoldRingProps = {
  holding: boolean;
};

export const HoldRing: FC<HoldRingProps> = (props) => {
  if (!props.holding) {
    return undefined;
  }
  return (
    <Box
      component='svg'
      viewBox='0 0 48 48'
      aria-hidden
      sx={{
        position: 'absolute',
        width: 48,
        height: 48,
        transform: 'rotate(-90deg)',
        pointerEvents: 'none',
        '& circle': {
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 3,
          strokeDasharray: ringLength,
          strokeDashoffset: ringLength,
          animation: `${fill} 500ms linear forwards`,
        },
      }}
    >
      <circle cx='24' cy='24' r='21' />
    </Box>
  );
};
