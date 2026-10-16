import { Box, Drawer, Popover, useMediaQuery } from '@mui/material';
import { type FC } from 'react';
import { pickerPlacements } from '../pickerPlacement.js';
import { useProjectStore } from '../store.js';
import { TempoPickerContent } from './TempoPickerContent.js';

export const TempoPicker: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const tempoAnchorEl = useProjectStore((state) => state.tempoAnchorEl);
  const setTempoAnchorEl = useProjectStore((state) => state.setTempoAnchorEl);
  const pickerSide = useProjectStore((state) => state.pickerSide);

  if (isDesktop) {
    return (
      <Popover
        open={!!tempoAnchorEl}
        anchorEl={tempoAnchorEl}
        onClose={() => {
          setTempoAnchorEl(undefined);
        }}
        {...pickerPlacements[pickerSide]}
      >
        <Box sx={{ width: 380, p: 4 }}>
          <TempoPickerContent />
        </Box>
      </Popover>
    );
  }

  return (
    <Drawer
      anchor='bottom'
      open={!!tempoAnchorEl}
      onClose={() => {
        setTempoAnchorEl(undefined);
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          p: 4,
          pb: 'max(18px, env(safe-area-inset-bottom))',
        }}
      >
        <TempoPickerContent />
      </Box>
    </Drawer>
  );
};
