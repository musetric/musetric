import { Box, Drawer, Popover, useMediaQuery } from '@mui/material';
import { type FC } from 'react';
import { useProjectStore } from '../store.js';
import { TransposePickerContent } from './TransposePickerContent.js';

export const TransposePicker: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const transposeAnchorEl = useProjectStore((state) => state.transposeAnchorEl);
  const setTransposeAnchorEl = useProjectStore(
    (state) => state.setTransposeAnchorEl,
  );

  if (isDesktop) {
    return (
      <Popover
        open={transposeAnchorEl !== undefined}
        anchorEl={transposeAnchorEl}
        onClose={() => {
          setTransposeAnchorEl(undefined);
        }}
        anchorOrigin={{
          horizontal: 'center',
          vertical: 'top',
        }}
        transformOrigin={{
          horizontal: 'center',
          vertical: 'bottom',
        }}
      >
        <Box width={340} p={2}>
          <TransposePickerContent />
        </Box>
      </Popover>
    );
  }

  return (
    <Drawer
      anchor='bottom'
      open={transposeAnchorEl !== undefined}
      onClose={() => {
        setTransposeAnchorEl(undefined);
      }}
    >
      <Box
        width='100%'
        maxWidth={460}
        mx='auto'
        p={2}
        pb='max(18px, env(safe-area-inset-bottom))'
      >
        <TransposePickerContent />
      </Box>
    </Drawer>
  );
};
