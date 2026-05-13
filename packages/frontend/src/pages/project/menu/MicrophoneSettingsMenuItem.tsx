import { ListItemText, MenuItem } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store.js';

export type MicrophoneSettingsMenuItemProps = {
  closeMenu: () => void;
};

export const MicrophoneSettingsMenuItem: FC<MicrophoneSettingsMenuItemProps> = (
  props,
) => {
  const { t } = useTranslation();
  const setMicrophoneSettingsOpen = useProjectStore(
    (state) => state.setMicrophoneSettingsOpen,
  );

  return (
    <MenuItem
      onClick={() => {
        props.closeMenu();
        setMicrophoneSettingsOpen(true);
      }}
    >
      <ListItemText primary={t('pages.project.menu.microphoneSettings')} />
    </MenuItem>
  );
};
