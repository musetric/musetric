import { Box, Dialog, Drawer, useMediaQuery } from '@mui/material';
import { type FC, useState } from 'react';
import { useProjectStore } from '../store.js';
import { MixdownContent } from './MixdownContent.js';

export const MixdownDialog: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const open = useProjectStore((state) => state.mixdownOpen);
  const setOpen = useProjectStore((state) => state.setMixdownOpen);
  const [paper, setPaper] = useState<HTMLDivElement | null>();

  if (isDesktop) {
    return (
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        slotProps={{
          paper: {
            ref: setPaper,
            sx: { width: 400, p: 6, borderRadius: 3 },
          },
        }}
      >
        <MixdownContent sideAnchor={paper ?? undefined} />
      </Dialog>
    );
  }

  return (
    <Drawer
      anchor='bottom'
      open={open}
      onClose={() => {
        setOpen(false);
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          boxSizing: 'border-box',
          p: 4,
          pb: 'max(18px, env(safe-area-inset-bottom))',
        }}
      >
        <MixdownContent />
      </Box>
    </Drawer>
  );
};
