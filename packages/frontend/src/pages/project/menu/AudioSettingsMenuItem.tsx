import { ListItemText, MenuItem } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store.js';

export type AudioSettingsMenuItemProps = {
  closeMenu: () => void;
};

export const AudioSettingsMenuItem: FC<AudioSettingsMenuItemProps> = (
  props,
) => {
  const { t } = useTranslation();
  const setAudioSettingsOpen = useProjectStore(
    (state) => state.setAudioSettingsOpen,
  );

  return (
    <MenuItem
      onClick={() => {
        props.closeMenu();
        setAudioSettingsOpen(true);
      }}
    >
      <ListItemText primary={t('pages.project.menu.audioSettings')} />
    </MenuItem>
  );
};
