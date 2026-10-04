import { ListItemText, MenuItem } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store.js';

export type MixdownMenuItemProps = {
  closeMenu: () => void;
};

export const MixdownMenuItem: FC<MixdownMenuItemProps> = (props) => {
  const { t } = useTranslation();
  const setMixdownOpen = useProjectStore((state) => state.setMixdownOpen);

  return (
    <MenuItem
      onClick={() => {
        props.closeMenu();
        setMixdownOpen(true);
      }}
    >
      <ListItemText primary={t('pages.project.menu.mixdown')} />
    </MenuItem>
  );
};
