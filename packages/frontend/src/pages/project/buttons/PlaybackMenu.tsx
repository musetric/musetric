import {
  Box,
  Drawer,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  useMediaQuery,
} from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useTimingStatus } from '../audioSettings/useTimingStatus.js';
import { AudioSettingsMenuItem } from '../menu/AudioSettingsMenuItem.js';
import { useProjectStore } from '../store.js';

export const PlaybackMenu: FC = () => {
  const { t } = useTranslation();
  const anchorEl = useProjectStore((state) => state.playbackMenuAnchorEl);
  const setAnchorEl = useProjectStore((state) => state.setPlaybackMenuAnchorEl);
  const onClose = () => {
    setAnchorEl(undefined);
  };
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const setCalibrationPrompt = useProjectStore(
    (state) => state.setCalibrationPrompt,
  );
  const status = useTimingStatus();
  const busy = useEngineStore((state) => state.recording || state.calibrating);
  const open = anchorEl !== undefined;
  const items = [
    <MenuItem
      key='calibrate'
      disabled={busy}
      onClick={() => {
        onClose();
        setCalibrationPrompt('menu');
      }}
    >
      <ListItemText
        primary={t('pages.project.playbackMenu.calibrate')}
        secondary={status.text}
      />
    </MenuItem>,
    <AudioSettingsMenuItem key='audioSettings' closeMenu={onClose} />,
  ];

  if (isDesktop) {
    return (
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={onClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {items}
      </Menu>
    );
  }

  return (
    <Drawer anchor='bottom' open={open} onClose={onClose}>
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          pt: 2,
          pb: 'calc(env(safe-area-inset-bottom) + 8px)',
        }}
      >
        <MenuList autoFocusItem={open}>{items}</MenuList>
      </Box>
    </Drawer>
  );
};
