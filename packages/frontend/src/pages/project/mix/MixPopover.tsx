import { Popover, Stack } from '@mui/material';
import { stemTypes } from '@musetric/audio';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { MixSlider } from './MixSlider.js';

export const MixPopover: FC = () => {
  const mixAnchorEl = useProjectStore((state) => state.mixAnchorEl);
  const setMixAnchorEl = useProjectStore((state) => state.setMixAnchorEl);

  return (
    <Popover
      open={mixAnchorEl !== undefined}
      anchorEl={mixAnchorEl}
      onClose={() => {
        setMixAnchorEl(undefined);
      }}
      anchorOrigin={{ horizontal: 'center', vertical: 'top' }}
      transformOrigin={{ horizontal: 'center', vertical: 'bottom' }}
    >
      <Stack width={260} p={4} gap={4}>
        {stemTypes.map((stemType) => (
          <MixSlider key={stemType} target={{ kind: 'delivery', stemType }} />
        ))}
        <MixSlider target={{ kind: 'recording' }} />
      </Stack>
    </Popover>
  );
};
