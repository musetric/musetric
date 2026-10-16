import { Popover, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { pickerPlacements } from '../pickerPlacement.js';
import { useProjectStore } from '../store.js';
import { MixSlider } from './MixSlider.js';

export const MixPopover: FC = () => {
  const mixAnchorEl = useProjectStore((state) => state.mixAnchorEl);
  const setMixAnchorEl = useProjectStore((state) => state.setMixAnchorEl);
  const pickerSide = useProjectStore((state) => state.pickerSide);

  return (
    <Popover
      open={mixAnchorEl !== undefined}
      anchorEl={mixAnchorEl}
      onClose={() => {
        setMixAnchorEl(undefined);
      }}
      {...pickerPlacements[pickerSide]}
    >
      <Stack sx={{ width: 260, p: 4, gap: 4 }}>
        <MixSlider target={{ kind: 'recording' }} />
        {stemTypes.map((stemType) => (
          <MixSlider key={stemType} target={{ kind: 'delivery', stemType }} />
        ))}
      </Stack>
    </Popover>
  );
};
