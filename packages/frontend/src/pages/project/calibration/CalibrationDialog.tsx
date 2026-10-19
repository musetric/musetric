import { Box, Dialog, Drawer, useMediaQuery } from '@mui/material';
import { type FC, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { useProjectStore } from '../store.js';
import { CalibrationContent } from './CalibrationContent.js';

export const CalibrationDialog: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const prompt = useProjectStore((state) => state.calibrationPrompt);
  const setPrompt = useProjectStore((state) => state.setCalibrationPrompt);
  const audioSettingsOpen = useProjectStore((state) => state.audioSettingsOpen);
  const setAudioSettingsOpen = useProjectStore(
    (state) => state.setAudioSettingsOpen,
  );
  const open = prompt !== undefined;

  useEffect(() => {
    if (!open || audioSettingsOpen) {
      return undefined;
    }
    return engine.calibration.openPreview();
  }, [open, audioSettingsOpen]);

  const close = () => {
    setPrompt(undefined);
    if (prompt === 'settings') {
      setAudioSettingsOpen(true);
    }
  };

  if (isDesktop) {
    return (
      <Dialog
        open={open}
        onClose={close}
        slotProps={{ paper: { sx: { width: 440, borderRadius: 3 } } }}
      >
        {prompt && (
          <CalibrationContent prompt={prompt} sheet={false} onClose={close} />
        )}
      </Dialog>
    );
  }

  return (
    <Drawer anchor='bottom' open={open} onClose={close}>
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          pb: 'env(safe-area-inset-bottom)',
        }}
      >
        {prompt && <CalibrationContent prompt={prompt} sheet onClose={close} />}
      </Box>
    </Drawer>
  );
};
