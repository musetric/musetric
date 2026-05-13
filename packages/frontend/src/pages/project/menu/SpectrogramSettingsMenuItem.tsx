import { ListItemText, MenuItem } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../settings/store.js';

export type SpectrogramSettingsMenuItemProps = {
  closeMenu: () => void;
};

export const SpectrogramSettingsMenuItem: FC<
  SpectrogramSettingsMenuItemProps
> = (props) => {
  const { t } = useTranslation();
  const setOpen = useSettingsStore((state) => state.setOpen);

  return (
    <MenuItem
      onClick={() => {
        props.closeMenu();
        setOpen(true);
      }}
    >
      <ListItemText primary={t('pages.project.menu.spectrogramSettings')} />
    </MenuItem>
  );
};
