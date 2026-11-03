import { Box, Drawer, Popover, useMediaQuery } from '@mui/material';
import { type FC, useEffect } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { RecordingList } from './RecordingList.js';

export const RecordingListPicker: FC = () => {
  const isDesktop = useMediaQuery(
    (theme) => `${theme.breakpoints.up('sm')} and (min-height: 600px)`,
  );
  const anchorEl = useProjectStore((state) => state.recordingListAnchorEl);
  const setAnchorEl = useProjectStore(
    (state) => state.setRecordingListAnchorEl,
  );
  const setRenamingRecordingId = useProjectStore(
    (state) => state.setRenamingRecordingId,
  );
  const recording = useEngineStore((state) => state.recording);
  const open = anchorEl !== undefined;

  useEffect(() => {
    if (recording) {
      setAnchorEl(undefined);
      setRenamingRecordingId(undefined);
    }
  }, [recording, setAnchorEl, setRenamingRecordingId]);

  const close = () => {
    setAnchorEl(undefined);
    setRenamingRecordingId(undefined);
  };

  if (isDesktop) {
    return (
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        slotProps={{ paper: { sx: { mt: 0.5, width: 560 } } }}
      >
        <RecordingList compact={false} onClose={close} />
      </Popover>
    );
  }

  return (
    <Drawer anchor='bottom' open={open} onClose={close}>
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          pb: 'max(8px, calc(env(safe-area-inset-bottom) - (100lvh - var(--visible-height, 100lvh))))',
        }}
      >
        <RecordingList compact onClose={close} />
      </Box>
    </Drawer>
  );
};
