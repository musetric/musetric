import { Button, Stack } from '@mui/material';
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
    <Stack sx={{ px: gutter, pt: 4, pb: 6, gap: 2 }}>
      <Button
        variant='contained'
        size='large'
        fullWidth
        disabled={!primary.onClick}
        onClick={primary.onClick}
      >
        {primary.label}
      </Button>
      <Button
        fullWidth
        disabled={!secondary.onClick}
        onClick={secondary.onClick}
      >
        {secondary.label}
      </Button>
    </Stack>
  );
};
