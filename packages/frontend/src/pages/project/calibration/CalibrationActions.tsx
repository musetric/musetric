import { Button, Stack } from '@mui/material';
import { type FC } from 'react';
import { type CalibrationAction } from './useCalibrationFlow.js';

export type CalibrationActionsProps = {
  primary?: CalibrationAction;
  secondary?: CalibrationAction;
  sheet: boolean;
  gutter: number;
};

export const CalibrationActions: FC<CalibrationActionsProps> = (props) => {
  const { primary, secondary, sheet, gutter } = props;
  if (sheet) {
    return (
      <Stack sx={{ px: gutter, pt: 5, pb: 6, gap: 2 }}>
        {primary && (
          <Button
            variant='contained'
            size='large'
            fullWidth
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        )}
        {secondary && (
          <Button fullWidth onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </Stack>
    );
  }
  return (
    <Stack
      direction='row'
      sx={{ px: gutter, py: 5, gap: 2, justifyContent: 'flex-end' }}
    >
      {secondary && (
        <Button onClick={secondary.onClick}>{secondary.label}</Button>
      )}
      {primary && (
        <Button variant='contained' onClick={primary.onClick}>
          {primary.label}
        </Button>
      )}
    </Stack>
  );
};
