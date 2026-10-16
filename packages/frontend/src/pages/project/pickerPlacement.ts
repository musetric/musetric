import { type PopoverOrigin } from '@mui/material';

const sideGap = -8;

export type PickerSide = 'top' | 'end';

type PickerPlacement = {
  anchorOrigin: PopoverOrigin;
  transformOrigin: PopoverOrigin;
};

export const pickerPlacements: Record<PickerSide, PickerPlacement> = {
  top: {
    anchorOrigin: { horizontal: 'center', vertical: 'top' },
    transformOrigin: { horizontal: 'center', vertical: 'bottom' },
  },
  end: {
    anchorOrigin: { horizontal: 'right', vertical: 'top' },
    transformOrigin: { horizontal: sideGap, vertical: 'top' },
  },
};
