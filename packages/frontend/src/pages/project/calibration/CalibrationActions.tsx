import { Box, Button } from '@mui/material';
import { type FC } from 'react';
import { type CalibrationAction } from './useCalibrationFlow.js';

export type CalibrationActionsProps = {
  primary: CalibrationAction;
  secondary: CalibrationAction;
  gutter: number;
};

export const CalibrationActions: FC<CalibrationActionsProps> = (props) => {
  const { primary, secondary, gutter } = props;
  return (
    <Box
      sx={{
        px: gutter,
        pt: 3,
        pb: 5,
        gap: 2,
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      }}
    >
      <Button
        size='large'
        disabled={!secondary.onClick}
        onClick={secondary.onClick}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {secondary.label}
      </Button>
      <Button
        variant='contained'
        size='large'
        disabled={!primary.onClick}
        onClick={primary.onClick}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {primary.label}
      </Button>
    </Box>
  );
};
